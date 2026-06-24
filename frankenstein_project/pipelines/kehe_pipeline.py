"""
KeHE GS1-128 label pipeline
---------------------------
Generates 4 x 6 in KeHE SSCC-18 / GS1-128 pallet/carton labels directly
from EDI 856 ASN XML files. No shipping-label PDF matching is performed.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

import hashlib

import fitz
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import code128, createBarcodeDrawing
from reportlab.lib.pagesizes import LETTER, A4, landscape
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


# ===========================================================================
# Global constants
# ===========================================================================
UPS_RE = re.compile(r"(1Z[0-9A-Z]{16})")


# ===========================================================================
# KeHE DC Directory (read from data/kehe_dc_directory.json by default)
# ===========================================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DIRECTORY_PATH = Path(
    os.getenv("KEHE_DC_DIRECTORY_FILE", str(PROJECT_ROOT / "data" / "kehe_dc_directory.json"))
)


def _normalize(value: str) -> str:
    """Normalize string for matching: lowercase, remove punctuation, normalize whitespace."""
    value = (value or "").lower()
    value = value.replace(".", "")
    value = value.replace(",", "")
    value = re.sub(r"\s+", " ", value).strip()
    return value


@lru_cache(maxsize=1)
def load_kehe_dc_directory() -> dict[str, dict[str, Any]]:
    """Load and validate KeHE DC directory from JSON file.
    
    Returns the directory data from kehe_dc_directory.json with validation.
    Raises ValueError if data is invalid.
    """
    with DIRECTORY_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError("KeHE DC directory JSON must be an object keyed by DC number.")
    required = {"dc", "name", "delivery_address", "billing_address", "match_values"}
    for dc, row in data.items():
        missing = required - set(row)
        if missing:
            raise ValueError(
                f"KeHE DC directory row {dc} is missing: {', '.join(sorted(missing))}"
            )
        if not isinstance(row["match_values"], list):
            raise ValueError(
                f"KeHE DC directory row {dc} match_values must be a list."
            )
    return data


def find_kehe_dc(
    *,
    st_gln: str = "",
    line1: str = "",
    city: str = "",
    state: str = "",
    zip_code: str = "",
) -> dict[str, Any] | None:
    """Find a KeHE DC entry by GLN or address fragment.

    GLN match (exact) takes priority; falls back to normalized substring match
    against haystack built from all provided address fields.
    """
    directory = load_kehe_dc_directory()
    st_gln = (st_gln or "").strip()
    haystack = _normalize(" ".join([st_gln, line1, city, state, zip_code]))

    if st_gln:
        for row in directory.values():
            if st_gln in row.get("match_values", []):
                return row

    for row in directory.values():
        for raw_value in row.get("match_values", []):
            value = _normalize(raw_value)
            if value and value in haystack:
                return row

    return None


def _status_log(*args: Any, **kwargs: Any) -> None:
    kwargs.setdefault("file", sys.stderr)
    kwargs.setdefault("flush", True)
    try:
        print(*args, **kwargs)
    except (BrokenPipeError, OSError):
        return


# ===========================================================================
# Data model
# ===========================================================================

@dataclass
class Address:
    name: str = ""
    line1: str = ""
    line2: str = ""
    city: str = ""
    state: str = ""
    zip: str = ""
    country: str = ""


@dataclass
class Item:
    vendor_item: str = ""
    retailer_item: str = ""
    upc: str = ""
    case_upc: str = ""
    description: str = ""
    qty: int = 0
    uom: str = ""
    lot: str = ""
    expiration_date: str = ""
    manufacture_date: str = ""
    plant: str = ""


@dataclass
class Pack:
    sscc: str
    tracking: str = ""
    po: str = ""
    store: str = ""
    ship_date: str = ""
    ship_from: Address = field(default_factory=Address)
    ship_to: Address = field(default_factory=Address)
    event_code: str = ""
    items: List[Item] = field(default_factory=list)
    carrier_name: str = ""
    scac: str = ""
    bol: str = ""
    pro: str = ""
    carton_index: int = 1
    total_cartons: int = 1
    package_type: str = "CTN"  # CTN prints Carton wording; PLT prints Pallet wording.
    lot: str = ""
    expiration_date: str = ""
    plant: str = ""


@dataclass
class Order:
    po: str
    store: str
    ship_to: Address
    ship_from: Address
    items: List[Item] = field(default_factory=list)
    packs: List[Pack] = field(default_factory=list)


class MatchFailureError(ValueError):
    """Compatibility placeholder. Matching is intentionally disabled in this app."""

    def __init__(self, message: str, report: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.report = report or {}


# ===========================================================================
# XML helpers
# ===========================================================================

def _get_elem(seg: Optional[ET.Element], pos: str) -> str:
    if seg is None:
        return ""
    el = seg.find(f"./Element[@Pos='{pos}']")
    return (el.attrib.get("Value") if el is not None else "") or ""


def _looks_like_store(s: str) -> bool:
    s = (s or "").strip()
    return s.isdigit() and len(s) >= 3


def _store_from_name(name: str) -> str:
    m = re.search(r"#\s*(\d+)", (name or ""))
    return m.group(1) if m else ""


def _parse_store_from_n1(n1_seg: Optional[ET.Element]) -> str:
    if n1_seg is None:
        return ""
    n102 = _get_elem(n1_seg, "02")
    n104 = _get_elem(n1_seg, "04")
    if _looks_like_store(n104):
        return n104
    return _store_from_name(n102)


def _parse_lin_pairs(lin_seg: Optional[ET.Element]) -> Dict[str, str]:
    if lin_seg is None:
        return {}

    elems = sorted(
        lin_seg.findall("./Element"),
        key=lambda el: int(el.attrib.get("Pos", "0") or 0),
    )
    vals = [(el.attrib.get("Value") or "").strip() for el in elems]
    out: Dict[str, str] = {}

    # X12 LIN is normally LIN01=line id, LIN02=qualifier, LIN03=value.
    # Some exports omit LIN01. Try both offsets and keep recognized pairs.
    known_qualifiers = {
        "VN", "VC", "VP", "IN", "BP", "CB", "UK", "UP", "UA", "EN", "SK", "PI", "MG"
    }
    for start in (0, 1):
        for i in range(start, len(vals) - 1, 2):
            q = vals[i].upper()
            v = vals[i + 1]
            if not q or not v:
                continue
            if q in known_qualifiers or (q.isalpha() and 1 <= len(q) <= 3):
                out.setdefault(q, v)
    return out


def _format_edi_date(value: str) -> str:
    """Normalize EDI/XML dates to MM/DD/YYYY for labels."""
    value = (value or "").strip()
    if not value:
        return ""

    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$", value)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        year_s = m.group(3)
        year = int(year_s) + 2000 if len(year_s) == 2 else int(year_s)
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    digits = re.sub(r"\D", "", value)
    if len(digits) == 8:
        first4 = int(digits[:4])
        last4 = int(digits[4:8])

        # Prefer canonical EDI CCYYMMDD, but still support MMDDYYYY.
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"
        return value

    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"

    return value


def _segment_refs(container: ET.Element, seg_id: str, deep: bool = False) -> List[ET.Element]:
    path = f".//SegmentRef[@ID='{seg_id}']" if deep else f"./SegmentRef[@ID='{seg_id}']"
    return list(container.findall(path))


def _scan_ref_values(container: ET.Element, deep: bool = False) -> Dict[str, List[str]]:
    refs: Dict[str, List[str]] = {}
    for ref in _segment_refs(container, "REF", deep=deep):
        qual = (_get_elem(ref, "01") or "").strip().upper()
        value = (_get_elem(ref, "02") or "").strip()
        if qual and value:
            refs.setdefault(qual, []).append(value)
    return refs


def _first_ref(refs: Dict[str, List[str]], qualifiers: Tuple[str, ...]) -> str:
    for q in qualifiers:
        vals = refs.get(q, [])
        if vals:
            return vals[0]
    return ""


def _scan_dates(container: ET.Element, deep: bool = False) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for dtm in _segment_refs(container, "DTM", deep=deep):
        qual = (_get_elem(dtm, "01") or "").strip().upper()
        value = (_get_elem(dtm, "02") or "").strip()
        if qual and value:
            out.setdefault(qual, _format_edi_date(value))
    return out


def _parse_address(n1loop: ET.Element) -> Tuple[str, Address]:
    n1 = n1loop.find("./SegmentRef[@ID='N1']")
    n3 = n1loop.find("./SegmentRef[@ID='N3']")
    n4 = n1loop.find("./SegmentRef[@ID='N4']")
    if n1 is None:
        return "", Address()
    qual = _get_elem(n1, "01")
    return qual, Address(
        name=_get_elem(n1, "02"),
        line1=_get_elem(n3, "01") if n3 is not None else "",
        line2=_get_elem(n3, "02") if n3 is not None else "",
        city=_get_elem(n4, "01") if n4 is not None else "",
        state=_get_elem(n4, "02") if n4 is not None else "",
        zip=_get_elem(n4, "03") if n4 is not None else "",
        country=_get_elem(n4, "04") if n4 is not None else "",
    )



def _package_type_from_td1_code(value: str) -> str:
    """Return CTN or PLT from shipment TD101 package code/text."""
    raw = (value or "").strip().upper()
    if not raw:
        return ""

    normalized = re.sub(r"[^A-Z0-9]+", " ", raw)
    tokens = set(normalized.split())

    if "PLT" in tokens or "PALLET" in tokens or "PALLETS" in tokens or "PLT" in normalized:
        return "PLT"
    if "CTN" in tokens or "CARTON" in tokens or "CARTONS" in tokens or "CTN" in normalized:
        return "CTN"

    return ""

# ===========================================================================
# ASN parser
# ===========================================================================

def _parse_shipment_group(
    bsn_seg: ET.Element,
    hl_loops: List[ET.Element],
) -> Tuple[List[Order], List[Pack]]:
    event_code = _get_elem(bsn_seg, "01")
    shipment_tracking = _get_elem(bsn_seg, "02")

    ship_date = ""
    ship_from = Address()
    ship_to_by_store: Dict[str, Address] = {}
    shipment_ship_to = Address()  # fallback when no store key matches
    shipment_carrier_name = ""
    shipment_scac = ""
    shipment_bol = ""
    shipment_pro = ""
    shipment_td5_pro = ""
    shipment_package_type = "CTN"

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

        if level == "S":
            for td1 in _segment_refs(hl, "TD1", deep=False):
                detected_package_type = _package_type_from_td1_code(_get_elem(td1, "01"))
                if detected_package_type:
                    shipment_package_type = detected_package_type
                    break

            for td5 in _segment_refs(hl, "TD5", deep=False):
                # Per XML mapping, TD5-03 is the carrier identifier/name to print (e.g. UPSN, KEHE).
                shipment_scac = shipment_scac or _get_elem(td5, "03") or _get_elem(td5, "02")
                shipment_carrier_name = shipment_carrier_name or _get_elem(td5, "03")
                shipment_td5_pro = shipment_td5_pro or _get_elem(td5, "05")

            for td3 in _segment_refs(hl, "TD3", deep=False):
                v = (_get_elem(td3, "03") or "").replace(" ", "")
                m = UPS_RE.search(v.upper())
                if m:
                    shipment_tracking = m.group(1)
                    break

            refs = _scan_ref_values(hl, deep=False)
            shipment_bol = _first_ref(refs, ("BM", "MB", "BL"))
            shipment_pro = _first_ref(refs, ("CN", "2I", "SI", "PK", "TR"))
            if not shipment_pro and shipment_td5_pro:
                shipment_pro = shipment_td5_pro
            if not shipment_pro and _get_elem(bsn_seg, "02"):
                shipment_pro = _get_elem(bsn_seg, "02")
            if not shipment_pro and shipment_bol:
                shipment_pro = shipment_bol

            dates = _scan_dates(hl, deep=False)
            ship_date = dates.get("011") or dates.get("017") or dates.get("068") or ""

            for n1loop in hl.findall(".//N1-LOOP"):
                n1 = n1loop.find("./SegmentRef[@ID='N1']")
                if n1 is None:
                    continue
                qual, addr = _parse_address(n1loop)
                store = _parse_store_from_n1(n1)
                if qual == "SF" and any([addr.name, addr.line1, addr.city]):
                    ship_from = addr
                if qual == "ST":
                    if any([addr.name, addr.city, addr.zip]):
                        shipment_ship_to = shipment_ship_to if shipment_ship_to.zip else addr
                    if store:
                        ship_to_by_store[store] = addr

    orders: List[Order] = []
    packs_flat: List[Pack] = []
    order_by_hl_id: Dict[str, Order] = {}
    pack_by_hl_id: Dict[str, Pack] = {}
    pack_order_by_hl_id: Dict[str, Order] = {}
    pending_items_by_pack_hl: Dict[str, List[Item]] = {}

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = (_get_elem(hl_seg, "03") or "").strip().upper()
        hl_id = (_get_elem(hl_seg, "01") or "").strip()
        parent_hl_id = (_get_elem(hl_seg, "02") or "").strip()

        if level == "O":
            prf = hl.find("./SegmentRef[@ID='PRF']")
            po = _get_elem(prf, "01") if prf is not None else ""
            store = ""
            ship_to = Address()

            for n1loop in hl.findall(".//N1-LOOP"):
                n1 = n1loop.find("./SegmentRef[@ID='N1']")
                if n1 is None:
                    continue
                qual = _get_elem(n1, "01")
                if qual == "BY":
                    cand = _get_elem(n1, "04")
                    if _looks_like_store(cand):
                        store = cand
                    else:
                        store = _store_from_name(_get_elem(n1, "02")) or store
                if qual == "ST":
                    store = _parse_store_from_n1(n1) or store
                    _q, ship_to = _parse_address(n1loop)

            if not ship_to.name and store:
                ship_to = ship_to_by_store.get(store, Address())
            # Fallback: use the shipment-level ST address when no order-level
            # address was found (e.g., XMLs where N1/N4 only appear at HL=S).
            if not ship_to.zip and shipment_ship_to.zip:
                ship_to = shipment_ship_to

            order = Order(po=po, store=store, ship_to=ship_to, ship_from=ship_from)
            orders.append(order)
            if hl_id:
                order_by_hl_id[hl_id] = order

        elif level == "P":
            order = order_by_hl_id.get(parent_hl_id)
            if order is None:
                raise ValueError(
                    f"Unable to map pack HL {hl_id or '(unknown)'} to an order HL via parent id {parent_hl_id or '(missing)'}."
                )
            man = hl.find("./SegmentRef[@ID='MAN']")
            sscc = _get_elem(man, "02") if man is not None else ""
            if not sscc:
                raise ValueError(f"Missing SSCC (MAN02) for PO {order.po}")

            pack_plant = ""
            for n1loop in hl.findall(".//N1-LOOP"):
                n1 = n1loop.find("./SegmentRef[@ID='N1']")
                if n1 is None:
                    continue
                if (_get_elem(n1, "01") or "").strip().upper() == "MF":
                    pack_plant = (_get_elem(n1, "04") or "").strip()
                    if not pack_plant:
                        pack_plant = (_get_elem(n1, "02") or "").strip()
                    if pack_plant:
                        break

            pack_refs = _scan_ref_values(hl, deep=False)
            pack_tracking = shipment_tracking
            for value in [v for vals in pack_refs.values() for v in vals]:
                m = UPS_RE.search(value.replace(" ", "").upper())
                if m:
                    pack_tracking = m.group(1)
                    break

            for td3 in _segment_refs(hl, "TD3", deep=False):
                v = (_get_elem(td3, "03") or "").replace(" ", "")
                m = UPS_RE.search(v.upper())
                if m:
                    pack_tracking = m.group(1)
                    break

            pack_dates = _scan_dates(hl, deep=False)
            pack = Pack(
                sscc=sscc,
                tracking=pack_tracking,
                po=order.po,
                store=order.store,
                ship_date=ship_date,
                ship_from=order.ship_from,
                ship_to=order.ship_to,
                event_code=event_code,
                carrier_name=shipment_carrier_name,
                scac=shipment_scac,
                bol=_first_ref(pack_refs, ("BM", "MB", "BL")) or shipment_bol,
                pro=_first_ref(pack_refs, ("CN", "2I", "SI", "PK", "TR")) or shipment_pro or shipment_bol,
                package_type=shipment_package_type,
                lot=_first_ref(pack_refs, ("LT", "LO", "BT")),
                # DTM 036/361 are expiration-type dates; 094 is manufacture date.
                expiration_date=pack_dates.get("036") or pack_dates.get("361") or "",
                plant=pack_plant,
            )
            order.packs.append(pack)
            packs_flat.append(pack)
            if hl_id:
                pack_by_hl_id[hl_id] = pack
                pack_order_by_hl_id[hl_id] = order
                pending_items = pending_items_by_pack_hl.pop(hl_id, [])
                for pending_item in pending_items:
                    pack.items.append(pending_item)
                    order.items.append(pending_item)

        elif level == "I":
            lin = hl.find("./SegmentRef[@ID='LIN']")
            sn1 = hl.find("./SegmentRef[@ID='SN1']")
            pid = hl.find("./SegmentRef[@ID='PID']")
            pairs = _parse_lin_pairs(lin)
            qty_s = _get_elem(sn1, "02") if sn1 is not None else "0"
            try:
                qty = int(float(qty_s))
            except Exception:
                qty = 0

            refs = _scan_ref_values(hl, deep=False)
            dates = _scan_dates(hl, deep=False)
            parent_pack = pack_by_hl_id.get(parent_hl_id)
            item = Item(
                vendor_item=pairs.get("VN", "") or pairs.get("VC", "") or pairs.get("VP", "") or pairs.get("SK", ""),
                retailer_item=pairs.get("CB", "") or pairs.get("IN", "") or pairs.get("BP", "") or pairs.get("PI", ""),
                upc=pairs.get("UP", "") or pairs.get("UA", "") or pairs.get("EN", "") or pairs.get("UK", ""),
                case_upc=pairs.get("UK", ""),
                description=_get_elem(pid, "05") if pid is not None else "",
                qty=qty,
                uom=_get_elem(sn1, "03") if sn1 is not None else "",
                lot=_first_ref(refs, ("LT", "LO", "BT")) or (parent_pack.lot if parent_pack else ""),
                expiration_date=dates.get("036") or dates.get("361") or (parent_pack.expiration_date if parent_pack else ""),
                manufacture_date=dates.get("094") or dates.get("371") or dates.get("118") or dates.get("011") or "",
                plant=_first_ref(refs, ("PL", "MF", "SU")) or (parent_pack.plant if parent_pack else ""),
            )
            if parent_pack is None:
                if parent_hl_id:
                    pending_items_by_pack_hl.setdefault(parent_hl_id, []).append(item)
                continue
            parent_pack.items.append(item)
            owner_order = pack_order_by_hl_id.get(parent_hl_id)
            if owner_order is not None:
                owner_order.items.append(item)

    seen_sscc: set[str] = set()
    deduped: List[Pack] = []
    for p in packs_flat:
        key = normalize_sscc(p.sscc) or p.sscc
        if key not in seen_sscc:
            seen_sscc.add(key)
            deduped.append(p)

    total = len(deduped) or 1
    for idx, pack in enumerate(deduped, start=1):
        pack.carton_index = idx
        pack.total_cartons = total

    return orders, deduped


def parse_asn(xml_path: str) -> Tuple[List[Order], List[Pack]]:
    root = ET.parse(xml_path).getroot()

    parent_map: Dict[ET.Element, List[Tuple[int, ET.Element]]] = {}
    for elem in root.iter():
        children = list(elem)
        for idx, child in enumerate(children):
            tag = child.tag
            seg_id = child.attrib.get("ID", "")
            if (tag == "SegmentRef" and seg_id == "BSN") or tag == "HL-LOOP":
                parent_map.setdefault(elem, []).append((idx, child))

    all_orders: List[Order] = []
    all_packs: List[Pack] = []

    for _parent, items in parent_map.items():
        groups: List[Tuple[ET.Element, List[ET.Element]]] = []
        current_bsn: Optional[ET.Element] = None
        current_hls: List[ET.Element] = []

        for _idx, child in items:
            if child.tag == "SegmentRef" and child.attrib.get("ID") == "BSN":
                if current_bsn is not None:
                    groups.append((current_bsn, current_hls))
                current_bsn = child
                current_hls = []
            elif child.tag == "HL-LOOP":
                if current_bsn is not None:
                    current_hls.append(child)

        if current_bsn is not None:
            groups.append((current_bsn, current_hls))

        for bsn_seg, hl_loops in groups:
            orders, packs = _parse_shipment_group(bsn_seg, hl_loops)
            all_orders.extend(orders)
            all_packs.extend(packs)

    seen: set[str] = set()
    deduped: List[Pack] = []
    for p in all_packs:
        key = (normalize_sscc(p.sscc), p.po.strip(), p.store.strip())
        if key not in seen:
            seen.add(key)
            deduped.append(p)

    total = len(deduped) or 1
    for idx, pack in enumerate(deduped, start=1):
        pack.carton_index = idx
        pack.total_cartons = total

    return all_orders, deduped


# ===========================================================================
# Layout helpers
# ===========================================================================

def wrap_text(text: str, font_name: str, font_size: float, max_width: float, max_lines: int = 99) -> List[str]:
    text = re.sub(r"\s+", " ", (text or "").strip())
    if not text:
        return []
    words = text.split()
    lines: List[str] = []
    cur = ""
    for word in words:
        test = (cur + " " + word).strip()
        if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = word
        if len(lines) >= max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    if lines and len(lines) == max_lines and len(" ".join(words)) > len(" ".join(lines)):
        lines[-1] = lines[-1].rstrip(" .") + "..."
    return lines


def normalize_sscc(sscc_raw: str) -> str:
    digits = re.sub(r"\D", "", sscc_raw or "")
    if len(digits) >= 20 and digits.startswith("00"):
        return digits[2:20]
    if len(digits) == 18:
        return digits
    return digits[-18:] if len(digits) > 18 else digits


def format_sscc_groups(sscc18: str) -> str:
    d = sscc18
    if len(d) != 18:
        return d
    return f"{d[0]} {d[1:3]} {d[3:8]} {d[8:17]} {d[17]}"


def _zip_for_ai420(zip_code: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", (zip_code or "").strip())


def _format_label_date_mmddyyyy(value: str) -> str:
    """Convert any label date value to MM/DD/YYYY. Leave MIXED/blank untouched."""
    value = (value or "").strip()
    if not value or value.upper() == "MIXED":
        return value

    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$", value)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        year_s = m.group(3)
        year = int(year_s) + 2000 if len(year_s) == 2 else int(year_s)
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    digits = re.sub(r"\D", "", value)
    if len(digits) == 8 and 1900 <= int(digits[:4]) <= 2100:
        return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"
    if len(digits) == 8 and 1900 <= int(digits[4:8]) <= 2100:
        return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"
    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"

    return value


def _one_or_mixed(values: List[str], default: str = "") -> str:
    vals = [v.strip() for v in values if v and v.strip()]
    unique = []
    for v in vals:
        if v not in unique:
            unique.append(v)
    if not unique:
        return default
    if len(unique) == 1:
        return unique[0]
    return "MIXED"


def _pack_content_summary(pack: Pack) -> Dict[str, str]:
    qty = sum(max(0, it.qty) for it in pack.items)
    if not pack.items:
        return {
            "contents": "",
            "item": "",
            "desc": "",
            "qty": "",
            "lot": "",
            "expiration": "",
            "manufacture": "",
            "plant": "",
        }

    mixed = len(pack.items) > 2
    upcs = [it.upc or it.retailer_item or it.vendor_item for it in pack.items]
    descs = [it.description for it in pack.items]
    return {
        "contents": "MIXED" if mixed else (_one_or_mixed(upcs) or ""),
        "item": "MIXED" if mixed else (_one_or_mixed([it.retailer_item or it.upc or it.vendor_item for it in pack.items]) or ""),
        "desc": "MIXED" if mixed else (_one_or_mixed(descs) or ""),
        "qty": str(qty) if qty else "",
        "lot": _one_or_mixed([it.lot for it in pack.items]),
        "expiration": _one_or_mixed([it.expiration_date for it in pack.items]),
        "manufacture": _one_or_mixed([it.manufacture_date for it in pack.items]),
        "plant": _one_or_mixed([it.plant for it in pack.items]),
    }


def _draw_label(c: canvas.Canvas, x: float, y: float, text: str, size: float = 7.5) -> None:
    c.setFont("Helvetica-Bold", size)
    c.drawString(x, y, text)


def _draw_value_lines(
    c: canvas.Canvas,
    lines: List[str],
    x: float,
    y: float,
    width: float,
    size: float = 7.5,
    leading: float = 9,
    max_lines: int = 4,
) -> float:
    c.setFont("Helvetica", size)
    for line in lines[:max_lines]:
        for wrapped in wrap_text(line, "Helvetica", size, width, max_lines=1):
            c.drawString(x, y, wrapped)
            y -= leading
    return y


def _draw_vertical_zone(c: canvas.Canvas, text: str, x: float, y_mid: float) -> None:
    c.saveState()
    c.translate(x, y_mid)
    c.rotate(90)
    c.setFont("Helvetica", 6)
    c.drawCentredString(0, 0, text)
    c.restoreState()


def _draw_code128_centered(
    c: canvas.Canvas,
    value: str,
    x0: float,
    x1: float,
    y: float,
    height: float,
    max_width: float,
    bar_width: float = 0.014 * inch,
    min_bar_width: float = 0.0065 * inch,
) -> None:
    barcode = code128.Code128(value, barHeight=height, barWidth=bar_width, humanReadable=False)
    while barcode.width > max_width and bar_width > min_bar_width:
        bar_width *= 0.92
        barcode = code128.Code128(value, barHeight=height, barWidth=bar_width, humanReadable=False)
    barcode.drawOn(c, x0 + ((x1 - x0) - barcode.width) / 2, y)


# ===========================================================================
# KeHE GS1 label renderer
# ===========================================================================

def render_gs1_label_page(pack: Pack, order_index: int, total_orders: int) -> bytes:
    """Render one 4 x 6 KeHE SSCC-18 / GS1-128 label page."""
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    gx0 = 0.10 * inch
    gx1 = W - 0.10 * inch
    gy0 = 0.10 * inch
    gy1 = H - 0.14 * inch
    mid = (gx0 + gx1) / 2

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)

    # Rebalanced zones:
    # A/B, C/D, E/F, and G/H get more room.
    # Zone I is reduced because it previously consumed too much vertical space.
    y_top = gy1
    y_ab = y_top - 1.05 * inch
    y_cd = y_ab - 1.15 * inch
    y_ef = y_cd - 1.25 * inch
    y_gh = y_ef - 0.95 * inch

    c.setLineWidth(0.8)
    c.rect(gx0, gy0, gx1 - gx0, gy1 - gy0)
    for row_y in [y_ab, y_cd, y_ef, y_gh]:
        c.line(gx0, row_y, gx1, row_y)
    c.line(mid, y_cd, mid, y_top)

    pad = 0.07 * inch
    left_x = gx0 + pad
    right_x = mid + pad
    left_w = mid - gx0 - 2 * pad
    right_w = gx1 - mid - 2 * pad

    package_type = (pack.package_type or "CTN").strip().upper()
    is_pallet = package_type.startswith("PLT")
    package_singular = "Pallet" if is_pallet else "Carton"
    package_plural = "Pallets" if is_pallet else "Cartons"

    def draw_pair(
        label: str,
        value: str,
        x: float,
        y: float,
        max_width: float,
        *,
        label_size: float = 10.2,
        value_size: float = 10.0,
        label_width: float = 0.76 * inch,
    ) -> None:
        if not value:
            return
        _draw_label(c, x, y, label, label_size)
        c.setFont("Helvetica", value_size)
        wrapped = wrap_text(value, "Helvetica", value_size, max_width - label_width, max_lines=1)
        if wrapped:
            c.drawString(x + label_width, y, wrapped[0])

    # Zone A: Ship From.
    sf = pack.ship_from
    y = y_top - 0.15 * inch
    _draw_label(c, left_x, y, "Ship From:", 9.5)
    y -= 0.16 * inch
    _draw_value_lines(
        c,
        [sf.name, sf.line1, sf.line2, f"{sf.city}, {sf.state} {sf.zip}".strip(", "), sf.country],
        left_x,
        y,
        left_w,
        size=9.0,
        leading=9.7,
        max_lines=5,
    )

    # Zone B: Ship To.
    st = pack.ship_to
    ship_to_name = st.name
    if pack.store and pack.store not in ship_to_name:
        ship_to_name = f"{ship_to_name} #{pack.store}".strip()

    y = y_top - 0.15 * inch
    _draw_label(c, right_x, y, "Ship To:", 12.0)
    y -= 0.17 * inch
    _draw_value_lines(
        c,
        [ship_to_name, st.line1, st.line2, f"{st.city}, {st.state} {st.zip}".strip(", "), st.country],
        right_x,
        y,
        right_w,
        size=10.2,
        leading=10.8,
        max_lines=5,
    )

    # Zone C: Ship-to postal code barcode.
    zip_ai = _zip_for_ai420(st.zip)
    y = y_ab - 0.17 * inch
    c.setFont("Helvetica-Bold", 10.0)
    c.drawString(left_x, y, "(420) Ship To Postal Code")

    if zip_ai:
        _draw_code128_centered(
            c,
            "\xf1" + "420" + zip_ai,
            gx0 + 0.06 * inch,
            mid - 0.06 * inch,
            y_cd + 0.26 * inch,
            0.62 * inch,
            mid - gx0 - 0.12 * inch,
            bar_width=0.0155 * inch,
        )
        c.setFont("Helvetica", 9.0)
        c.drawCentredString((gx0 + mid) / 2, y_cd + 0.12 * inch, f"(420) {zip_ai}")

    # Zone D: Carrier / BOL / PRO / carton-or-pallet count.
    y = y_ab - 0.17 * inch
    carrier = pack.carrier_name or pack.scac

    draw_pair("Carrier:", carrier[:26], right_x, y, right_w, label_width=0.72 * inch)
    y -= 0.19 * inch

    draw_pair("B/L:", pack.bol[:30], right_x, y, right_w, label_width=0.42 * inch)
    y -= 0.19 * inch

    draw_pair("Pro:", pack.pro[:30], right_x, y, right_w, value_size=9.8, label_width=0.42 * inch)
    y -= 0.28 * inch

    _draw_label(c, right_x, y, f"Number of {package_plural}:", 10.3)
    y -= 0.20 * inch

    c.setFont("Helvetica-Bold", 10.4)
    c.drawString(right_x, y, f"{package_singular} {pack.carton_index} Of {pack.total_cartons}")

    # Zones E/F: Customer / retailer content.
    # Contents is first. Blank headings are skipped.
    summary = _pack_content_summary(pack)
    y = y_cd - 0.18 * inch
    content_label_w = 1.00 * inch
    value_w = gx1 - (left_x + content_label_w) - pad

    content_rows = [
        ("Contents:", summary["contents"]),
        ("PO #:", pack.po),
        ("Item #:", summary["item"]),
        ("Item Desc:", summary["desc"]),
        (f"{package_singular} Qty:", summary["qty"]),
    ]

    for label, value in content_rows:
        if not value:
            continue

        _draw_label(c, left_x, y, label, 10.2)
        c.setFont("Helvetica", 9.8)

        wrapped = wrap_text(value, "Helvetica", 9.8, value_w, max_lines=1)
        if wrapped:
            c.drawString(left_x + content_label_w, y, wrapped[0])

        y -= 0.18 * inch

    # Zones G/H: Lot and traceability information.
    y = y_ef - 0.18 * inch
    trace_label_w = 1.55 * inch

    trace_rows = [
        ("Lot #:", summary["lot"]),
        ("Expiration Date:", _format_label_date_mmddyyyy(summary["expiration"])),
        ("Manufacture Date:", _format_label_date_mmddyyyy(summary["manufacture"])),
        ("Manufacturing Plant #:", summary["plant"]),
    ]

    for label, value in trace_rows:
        if not value:
            continue

        _draw_label(c, left_x, y, label, 10.0)
        c.setFont("Helvetica", 9.6)

        wrapped = wrap_text(value, "Helvetica", 9.6, gx1 - (left_x + trace_label_w) - pad, max_lines=1)
        if wrapped:
            c.drawString(left_x + trace_label_w, y, wrapped[0])

        y -= 0.17 * inch

    # Zone I: SSCC barcode and human-readable text.
    # Reduced vertical height, but barcode is still kept wide.
    sscc18 = normalize_sscc(pack.sscc)
    c.setFont("Helvetica-Bold", 9.0)
    c.drawCentredString(W / 2, y_gh - 0.18 * inch, "Serialized Shipping Container Number")

    if sscc18:
        _draw_code128_centered(
            c,
            "\xf1" + "00" + sscc18,
            gx0 + 0.05 * inch,
            gx1 - 0.05 * inch,
            gy0 + 0.38 * inch,
            0.72 * inch,
            gx1 - gx0 - 0.10 * inch,
            bar_width=0.0165 * inch,
        )
        c.setFont("Helvetica", 8.8)
        c.drawCentredString(W / 2, gy0 + 0.17 * inch, f"(00) {format_sscc_groups(sscc18)}")

    c.showPage()
    c.save()
    return buf.getvalue()


# ===========================================================================
# Public API
# ===========================================================================

def _bytes_to_fitz(data: bytes) -> fitz.Document:
    return fitz.open(stream=data, filetype="pdf")


def _build_generation_report(rows: List[Dict[str, Any]], xml_files: int) -> Dict[str, Any]:
    return {
        "summary": {
            "success": True,
            "xml_files": xml_files,
            "generated_labels": len(rows),
        },
        "rows": rows,
    }


def run_pipeline(
    xml_paths: List[str],
    out_pdf: str,
    shipping_pdf_path: Optional[str] = None,
    ocr_dpi: int = 200,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    if shipping_pdf_path:
        _status_log("Shipping PDF input was supplied but is ignored by the KeHE XML-only workflow.")
    _ = ocr_dpi

    all_packs: List[Pack] = []
    for xp in xml_paths:
        _status_log(f"Parsing XML: {xp}")
        _orders, packs = parse_asn(xp)
        all_packs.extend(packs)

    seen_keys: set[Tuple[str, str, str]] = set()
    deduped: List[Pack] = []
    for p in all_packs:
        key = (normalize_sscc(p.sscc), p.po.strip(), p.store.strip())
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(p)
    all_packs = deduped

    if not all_packs:
        raise ValueError("No packs with SSCC values were found in the uploaded XML.")

    total = len(all_packs)
    for idx, pack in enumerate(all_packs, start=1):
        pack.carton_index = idx
        pack.total_cartons = total

    _status_log(f"Rendering {total} KeHE GS1 label(s): {out_pdf}")
    out_doc = fitz.open()
    rows: List[Dict[str, Any]] = []

    for i, pack in enumerate(all_packs, start=1):
        if progress_callback:
            progress_callback(f"Rendering KeHE label {i} of {total}...")
        page_bytes = render_gs1_label_page(pack, order_index=i, total_orders=total)
        page_doc = _bytes_to_fitz(page_bytes)
        out_doc.insert_pdf(page_doc, from_page=0, to_page=0)
        page_doc.close()
        rows.append({
            "label": i,
            "po": pack.po,
            "store": pack.store,
            "ship_to": pack.ship_to.name,
            "ship_to_zip": pack.ship_to.zip,
            "sscc": normalize_sscc(pack.sscc),
            "package_type": pack.package_type or "CTN",
            "package": f"{'Pallet' if (pack.package_type or '').upper().startswith('PLT') else 'Carton'} {pack.carton_index} of {pack.total_cartons}",
            "carton": f"{pack.carton_index} of {pack.total_cartons}",
        })

    out_doc.save(out_pdf, garbage=4, deflate=True)
    out_doc.close()
    _status_log(f"Done -> {out_pdf}")
    return _build_generation_report(rows, xml_files=len(xml_paths))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate KeHE GS1-128 labels from ASN XML")
    parser.add_argument("--xml", nargs="+", required=True, help="ASN XML file(s)")
    parser.add_argument("--out", required=True, help="Output PDF path")
    args = parser.parse_args()
    run_pipeline(xml_paths=args.xml, out_pdf=args.out)


# ===========================================================================
# KeHE Documents Pipeline: Pallet Placards and Master Packing Lists
# ===========================================================================

def _get_elem(seg: Optional[ET.Element], pos: str) -> str:
    if seg is None:
        return ""
    el = seg.find(f"./Element[@Pos='{pos}']")
    return (el.attrib.get("Value") if el is not None else "") or ""


def _format_date(value: str) -> str:
    """Convert various EDI date formats to MM-DD-YYYY for PDF consistency."""
    value = (value or "").strip()
    if not value:
        return ""
    m = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$", value)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        year_s = m.group(3)
        year = int(year_s) + 2000 if len(year_s) == 2 else int(year_s)
        return f"{mm:02d}-{dd:02d}-{year:04d}"
    digits = re.sub(r"\D", "", value)
    if len(digits) == 8:
        first4 = int(digits[:4])
        last4 = int(digits[4:8])
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}-{digits[6:8]}-{digits[0:4]}"
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}-{digits[2:4]}-{digits[4:8]}"
        return value
    if len(digits) == 6:
        return f"{digits[2:4]}-{digits[4:6]}-20{digits[0:2]}"
    return value


def _file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _segment_refs(container: ET.Element, seg_id: str, deep: bool = False) -> List[ET.Element]:
    path = f".//SegmentRef[@ID='{seg_id}']" if deep else f"./SegmentRef[@ID='{seg_id}']"
    return list(container.findall(path))


def _scan_ref_values(container: ET.Element, deep: bool = False) -> Dict[str, List[str]]:
    refs: Dict[str, List[str]] = {}
    for ref in _segment_refs(container, "REF", deep=deep):
        qual = (_get_elem(ref, "01") or "").strip().upper()
        value = (_get_elem(ref, "02") or "").strip()
        if qual and value:
            refs.setdefault(qual, []).append(value)
    return refs


def _first_ref(refs: Dict[str, List[str]], qualifiers: Tuple[str, ...]) -> str:
    for q in qualifiers:
        vals = refs.get(q, [])
        if vals:
            return vals[0]
    return ""


def _scan_dates(container: ET.Element, deep: bool = False) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for dtm in _segment_refs(container, "DTM", deep=deep):
        qual = (_get_elem(dtm, "01") or "").strip().upper()
        value = (_get_elem(dtm, "02") or "").strip()
        if qual and value:
            out.setdefault(qual, _format_date(value))
    return out


def _parse_n1loop_addr(n1loop: ET.Element) -> Tuple[str, Dict[str, str]]:
    n1 = n1loop.find("./SegmentRef[@ID='N1']")
    n3 = n1loop.find("./SegmentRef[@ID='N3']")
    n4 = n1loop.find("./SegmentRef[@ID='N4']")
    if n1 is None:
        return "", {}
    qual = _get_elem(n1, "01")
    return qual, {
        "name": _get_elem(n1, "02"),
        "gln": _get_elem(n1, "04"),
        "line1": _get_elem(n3, "01") if n3 is not None else "",
        "line2": _get_elem(n3, "02") if n3 is not None else "",
        "city": _get_elem(n4, "01") if n4 is not None else "",
        "state": _get_elem(n4, "02") if n4 is not None else "",
        "zip": _get_elem(n4, "03") if n4 is not None else "",
        "country": _get_elem(n4, "04") if n4 is not None else "",
    }


def _addr_dict_to_str(addr: Dict[str, str]) -> str:
    """Format an address dict as a multiline string for display."""
    parts = []
    if addr.get("name"):
        parts.append(addr["name"].upper())
    if addr.get("line1"):
        parts.append(addr["line1"].upper())
    if addr.get("line2"):
        parts.append(addr["line2"].upper())
    city = addr.get("city", "")
    state = addr.get("state", "")
    zip_code = addr.get("zip", "")
    city_line = ", ".join(filter(None, [city.upper(), state.upper()]))
    if zip_code:
        city_line = f"{city_line} {zip_code}".strip() if city_line else zip_code
    if city_line:
        parts.append(city_line)
    country = addr.get("country", "")
    if country and country.upper() not in ("US", "USA", ""):
        parts.append(country.upper())
    elif not country or country.upper() in ("US", "USA"):
        parts.append("USA")
    return "\n".join(parts)


# ===========================================================================
# XML header parser
# ===========================================================================

def parse_kehe_document_header(xml_path: str) -> Dict[str, Any]:
    """Parse shipment-level header fields from an EDI 856 ASN XML file.

    Returns metadata fields needed for Pallet Labels and Master Packing Lists.
    Does not duplicate parse_asn() — focuses on document-level header fields.
    """
    root = ET.parse(xml_path).getroot()
    header: Dict[str, Any] = {
        "source_file": Path(xml_path).name,
        "file_hash": _file_hash(xml_path),
        "bsn": "",
        "ship_date": "",
        "expected_delivery_date": "",
        "carrier": "",
        "pro_number": "",
        "bol_number": "",
        "td1_package_code": "",
        "td1_quantity": "",
        "td1_quantity_type": "",
        "carton_count": "",
        "xml_carton_count": "",
        "pack_count": "",
        "total_pallets": "",
        "xml_total_pallets": "",
        "total_weight": "",
        "cube": "",
        "customer_po_number": "",
        "po_date": "",
        "order_no": "",
        "vendor_number": "",
        "ship_to_gln": "",
        "xml_ship_to": {},
        "xml_ship_from": {},
        "warnings": [],
    }

    bsn_seg = root.find(".//SegmentRef[@ID='BSN']")
    if bsn_seg is not None:
        header["bsn"] = _get_elem(bsn_seg, "02")

    for hl in root.findall(".//HL-LOOP"):
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = (_get_elem(hl_seg, "03") or "").strip().upper()

        if level == "S":
            # TD1: package quantity, weight, cube.
            # Correct KeHE pallet XML can send TD101=PLT and TD102=total pallets.
            # Older/wrong exports can send TD101=CTN; in that case TD102 is carton count.
            for td1 in _segment_refs(hl, "TD1"):
                package_code = (_get_elem(td1, "01") or "").strip().upper()
                quantity = (_get_elem(td1, "02") or "").strip()
                if package_code and not header["td1_package_code"]:
                    header["td1_package_code"] = package_code
                if quantity and not header["td1_quantity"]:
                    header["td1_quantity"] = quantity

                package_text = package_code.replace(".", " ")
                is_pallet_qty = ("PLT" in package_text) or ("PALLET" in package_text)
                is_carton_qty = ("CTN" in package_text) or ("CARTON" in package_text)
                if quantity:
                    if is_pallet_qty:
                        header["td1_quantity_type"] = "pallet"
                        if not header["xml_total_pallets"]:
                            header["xml_total_pallets"] = quantity
                        if not header["total_pallets"]:
                            header["total_pallets"] = quantity
                    elif is_carton_qty:
                        header["td1_quantity_type"] = "carton"
                        if not header["xml_carton_count"]:
                            header["xml_carton_count"] = quantity
                        if not header["carton_count"]:
                            header["carton_count"] = quantity
                    elif not header["carton_count"]:
                        header["td1_quantity_type"] = "unknown"
                        header["carton_count"] = quantity

                weight = _get_elem(td1, "07")
                weight_unit = _get_elem(td1, "08")
                cube = _get_elem(td1, "09")
                cube_unit = _get_elem(td1, "10")
                if weight and not header["total_weight"]:
                    header["total_weight"] = (
                        f"{weight} {weight_unit}".strip() if weight_unit else weight
                    )
                if cube and not header["cube"]:
                    header["cube"] = f"{cube} {cube_unit}".strip() if cube_unit else cube

            # TD5: carrier, PRO from field 05
            td5_pro = ""
            for td5 in _segment_refs(hl, "TD5"):
                if not header["carrier"]:
                    header["carrier"] = _get_elem(td5, "03") or _get_elem(td5, "02")
                td5_pro = td5_pro or _get_elem(td5, "05")

            # REF: BOL, PRO
            refs = _scan_ref_values(hl)
            if not header["bol_number"]:
                header["bol_number"] = _first_ref(refs, ("BM", "MB", "BL"))
            if not header["pro_number"]:
                header["pro_number"] = (
                    _first_ref(refs, ("CN", "2I", "SI", "PK", "TR"))
                    or td5_pro
                )

            # DTM: ship date (011), expected delivery (017)
            dates = _scan_dates(hl)
            if not header["ship_date"]:
                header["ship_date"] = dates.get("011") or dates.get("068") or ""
            if not header["expected_delivery_date"]:
                header["expected_delivery_date"] = dates.get("017") or ""

            # N1 loops: ST = ship-to, SF = ship-from
            for n1loop in hl.findall(".//N1-LOOP"):
                qual, addr = _parse_n1loop_addr(n1loop)
                if qual == "ST" and not header["xml_ship_to"]:
                    header["ship_to_gln"] = addr.get("gln", "")
                    header["xml_ship_to"] = addr
                elif qual == "SF" and not header["xml_ship_from"]:
                    header["xml_ship_from"] = addr

        elif level == "O":
            # PRF: customer PO (PRF01), PO date (PRF04)
            prf = hl.find("./SegmentRef[@ID='PRF']")
            if prf is not None:
                if not header["customer_po_number"]:
                    header["customer_po_number"] = _get_elem(prf, "01")
                if not header["po_date"]:
                    raw = _get_elem(prf, "04")
                    if raw:
                        header["po_date"] = _format_date(raw)

            # REF: order number (VR), vendor number (IA)
            refs = _scan_ref_values(hl)
            if not header["order_no"]:
                header["order_no"] = _first_ref(refs, ("VR",))
            if not header["vendor_number"]:
                header["vendor_number"] = _first_ref(refs, ("IA",))

    # Cascade fallbacks for BOL / PRO
    if not header["pro_number"] and header["bol_number"]:
        header["pro_number"] = header["bol_number"]
    if not header["pro_number"] and header["bsn"]:
        header["pro_number"] = header["bsn"]
    if not header["bol_number"] and header["bsn"]:
        header["bol_number"] = header["bsn"]

    return header


# ===========================================================================
# Shipment normalization
# ===========================================================================

def build_document_shipments(xml_paths: List[str]) -> Dict[str, Any]:
    """Parse and deduplicate XML files into normalized shipment dicts.

    Deduplication is by file SHA-256 hash first, then by (SSCC, PO, DC) key.
    Returns:
        {
            "shipments": [...],
            "duplicate_files": [...]
        }
    """
    shipments = []
    file_hashes: set = set()
    duplicate_files: List[str] = []
    seen_keys: set = set()

    for xml_path in xml_paths:
        header = parse_kehe_document_header(xml_path)
        fhash = header["file_hash"]

        if fhash in file_hashes:
            duplicate_files.append(header["source_file"])
            continue
        file_hashes.add(fhash)

        try:
            orders, packs = parse_asn(xml_path)
        except Exception as exc:
            raise ValueError(
                f"Failed to parse {header['source_file']}: {exc}"
            ) from exc

        # Secondary dedup: same (sscc, po, dc GLN) across different files
        unique_packs = []
        for pack in packs:
            key = (
                normalize_sscc(pack.sscc),
                (pack.po or "").strip(),
                header.get("ship_to_gln", ""),
            )
            if key not in seen_keys:
                seen_keys.add(key)
                unique_packs.append(pack)

        header["pack_count"] = str(len(unique_packs)) if unique_packs else ""
        # If TD101=PLT, TD102 is pallet count, not carton count. The physical
        # carton/pack/label count still comes from HL03=P / MAN SSCC count.
        if not header.get("carton_count"):
            header["carton_count"] = str(len(unique_packs)) if unique_packs else ""
        if not header.get("total_pallets"):
            header["total_pallets"] = header.get("xml_total_pallets") or "1"

        dc_info = find_kehe_dc(
            st_gln=header["ship_to_gln"],
            line1=header["xml_ship_to"].get("line1", ""),
            city=header["xml_ship_to"].get("city", ""),
            state=header["xml_ship_to"].get("state", ""),
            zip_code=header["xml_ship_to"].get("zip", ""),
        )
        needs_review = dc_info is None

        if needs_review:
            header["warnings"].append(
                f"Unknown KeHE DC — could not match ship-to address to a known DC. "
                f"XML ship-to: {header['xml_ship_to'].get('line1', '')} "
                f"{header['xml_ship_to'].get('city', '')} "
                f"{header['xml_ship_to'].get('zip', '')}"
            )

        shipments.append({
            "header": header,
            "orders": orders,
            "packs": unique_packs,
            "dc_info": dc_info,
            "needs_review": needs_review,
        })

    return {"shipments": shipments, "duplicate_files": duplicate_files}


# ===========================================================================
# Draft builders
# ===========================================================================

def _ship_from_str(header: Dict[str, Any], packs: list) -> str:
    """Build ship-from address string from header or first pack."""
    sf = header.get("xml_ship_from") or {}
    if sf and sf.get("name"):
        return _addr_dict_to_str(sf)
    if packs:
        p = packs[0]
        addr = p.ship_from
        parts = []
        if addr.name:
            parts.append(addr.name.upper())
        if addr.line1:
            parts.append(addr.line1.upper())
        if addr.line2:
            parts.append(addr.line2.upper())
        city_line = ", ".join(filter(None, [addr.city.upper(), addr.state.upper()]))
        if addr.zip:
            city_line = f"{city_line} {addr.zip}".strip() if city_line else addr.zip
        if city_line:
            parts.append(city_line)
        if addr.country and addr.country.upper() not in ("US", "USA", ""):
            parts.append(addr.country.upper())
        else:
            parts.append("USA")
        return "\n".join(parts)
    return ""


def _ship_to_str(dc_info: Optional[Dict[str, Any]], xml_ship_to: Dict[str, str]) -> str:
    if dc_info:
        return dc_info["delivery_address"]
    raw = _addr_dict_to_str(xml_ship_to) if xml_ship_to else ""
    prefix = "NEEDS REVIEW \u2014 UNKNOWN KEHE DC\n\nXML Ship To:\n"
    return prefix + (raw or "(not found in XML)")


def _billing_str(dc_info: Optional[Dict[str, Any]]) -> str:
    if dc_info:
        return dc_info["billing_address"]
    return ""


def _pack_po_numbers(pack: Pack, fallback_po: str = "") -> str:
    """Return the PO number(s) that belong to one pallet/pack."""
    candidates = [pack.po, fallback_po]
    out: List[str] = []
    for value in candidates:
        value = (value or "").strip()
        if value and value not in out:
            out.append(value)
    return ", ".join(out)


def _pack_item_count(pack: Pack) -> int:
    return sum(max(0, int(getattr(item, "qty", 0) or 0)) for item in (pack.items or []))


def _build_pallet_label_entry(
    *,
    idx: int,
    status: str,
    dc: str,
    header: Dict[str, Any],
    ship_from: str,
    ship_to: str,
    billing: str,
    pallet_number: str,
    total_pallets: str,
    customer_po_numbers: str,
    carton_count: str,
    source_file: str,
    warnings: List[str],
    pack: Optional[Pack] = None,
) -> Dict[str, Any]:
    """Build one editable Pallet Placard draft record."""
    entry = {
        "id": f"PALLET-{idx}",
        "status": status,
        "dc": dc,
        "title": "PALLET PLACARD",
        "date": header.get("ship_date", ""),
        "ship_from": ship_from,
        "ship_to": ship_to,
        "billing": billing,
        "customer_po_numbers": customer_po_numbers,
        "bol_number": header.get("bol_number", ""),
        "pro_number": header.get("pro_number", ""),
        "carrier": header.get("carrier", ""),
        "pallet_number": pallet_number,
        "total_pallets": total_pallets,
        "carton_count": carton_count,
        "placement_note": (
            "Place one placard on the front and one placard on the back of the pallet."
        ),
        "copies": 2,
        "source_files": [source_file],
        "warnings": list(warnings),
    }
    if pack is not None:
        entry.update({
            "source_sscc": normalize_sscc(pack.sscc),
            "pack_index": str(pack.carton_index or pallet_number),
            "item_rows": str(len(pack.items or [])),
            "item_quantity": str(_pack_item_count(pack) or ""),
        })
    return entry


def build_kehe_pallet_label_draft(xml_paths: List[str]) -> Dict[str, Any]:
    """Parse XML files and return editable Pallet Placard drafts.

    Correct KeHE pallet XML sends TD101=PLT and TD102=total pallets. In that
    case each HL03=P loop / MAN SSCC is treated as one physical pallet and gets
    its own editable Pallet Placard draft. The PO printed on a placard is taken
    from that specific P-loop's parent order, not from a shipment-wide rollup.

    If XML does not explicitly say TD101=PLT, preserve the legacy behavior: one
    editable placard draft per shipment/group, with pallet count defaulting to 1.
    """
    if not xml_paths:
        raise ValueError("At least one XML file is required.")

    result = build_document_shipments(xml_paths)
    shipments = result["shipments"]
    duplicate_files = result["duplicate_files"]

    global_warnings: List[str] = []
    if duplicate_files:
        global_warnings.append(
            f"Duplicate file(s) skipped: {', '.join(duplicate_files)}"
        )

    pallets: List[Dict[str, Any]] = []
    needs_review_count = 0

    for ship in shipments:
        header = ship["header"]
        dc_info = ship["dc_info"]
        packs: List[Pack] = ship["packs"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        status = "Needs Review" if needs_review else "Ready"
        dc = dc_info["dc"] if dc_info else "Unknown"
        ship_from = _ship_from_str(header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)
        source_file = header.get("source_file", "")

        total_pallets = str(_safe_positive_int(
            header.get("total_pallets") or header.get("xml_total_pallets") or "1",
            1,
        ))
        explicit_pallet_xml = bool(header.get("xml_total_pallets")) and _safe_positive_int(total_pallets, 1) > 1

        base_warnings: List[str] = list(header.get("warnings", []))

        if explicit_pallet_xml:
            if len(packs) != _safe_positive_int(total_pallets, 1):
                base_warnings.append(
                    f"XML says Total Pallets={total_pallets}, but {len(packs)} P-loop/SSCC pallet records were found. Verify pallet labels."
                )
            for pack_index, pack in enumerate(packs, start=1):
                pallet_number = str(pack.carton_index or pack_index)
                po_on_pallet = _pack_po_numbers(pack, header.get("customer_po_number", ""))
                pallet_warnings = list(base_warnings)
                if not po_on_pallet:
                    pallet_warnings.append("PO number was not found for this pallet. Verify before printing.")
                pallets.append(_build_pallet_label_entry(
                    idx=len(pallets) + 1,
                    status=status,
                    dc=dc,
                    header=header,
                    ship_from=ship_from,
                    ship_to=ship_to,
                    billing=billing,
                    pallet_number=pallet_number,
                    total_pallets=total_pallets,
                    customer_po_numbers=po_on_pallet,
                    carton_count="1",
                    source_file=source_file,
                    warnings=pallet_warnings,
                    pack=pack,
                ))
        else:
            pallet_warnings = list(base_warnings)
            pallet_warnings.append(
                "Pallet count was not explicitly provided as TD101=PLT in XML. Defaulted to 1."
            )
            pallets.append(_build_pallet_label_entry(
                idx=len(pallets) + 1,
                status=status,
                dc=dc,
                header=header,
                ship_from=ship_from,
                ship_to=ship_to,
                billing=billing,
                pallet_number="1",
                total_pallets=total_pallets,
                customer_po_numbers=header.get("customer_po_number", ""),
                carton_count=header.get("carton_count") or header.get("pack_count", ""),
                source_file=source_file,
                warnings=pallet_warnings,
                pack=None,
            ))

    return {
        "document_type": "kehe_pallet_label",
        "version": 2,
        "summary": {
            "xml_files": len(xml_paths),
            "groups": len(pallets),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "pallets": pallets,
    }

def _display_uom(uom: str) -> str:
    value = (uom or "").strip().upper()
    if value == "CA":
        return "CASES"
    return value or "CASES"


def _safe_positive_int(value: Any, default: int = 1) -> int:
    try:
        n = int(str(value or "").strip())
        return n if n > 0 else default
    except (ValueError, TypeError):
        return default


def _pallet_ids_for_total(total_pallets: Any) -> List[str]:
    total = _safe_positive_int(total_pallets, 1)
    return [str(i) for i in range(1, total + 1)]


def _derive_case_upc(item: Item) -> str:
    if item.case_upc:
        return item.case_upc
    for value in (item.retailer_item, item.vendor_item):
        digits = re.sub(r"\D", "", value or "")
        if len(digits) >= 12:
            return value
    digits = re.sub(r"\D", "", item.upc or "")
    if len(digits) in (12, 13):
        return "2" + digits.zfill(13)
    return ""


def _aggregate_mpl_items_for_editor(
    packs: List[Pack],
    warnings: List[str],
    *,
    total_pallets: str = "1",
    preserve_pack_pallets: bool = False,
) -> List[Dict[str, Any]]:
    """Aggregate XML item rows into editable MPL lines.

    Important KeHE rule:
      - If TD101 says PLT/Pallet, each HL03=P loop is a physical pallet.
        Items must stay with their parent P loop.
      - If TD101 says CTN/Carton or the XML is unclear, keep all item rows on
        Pallet 1 and let the frontend/user edit Pallet # manually.

    The aggregation key includes pallet number whenever `preserve_pack_pallets`
    is true. That prevents the same UPC from being merged across different
    pallets and avoids the previous wrong round-robin pallet assignment.
    """
    aggregated: Dict[Tuple[str, str, str, str, str, str, str], Dict[str, Any]] = {}
    allowed_pallets = set(_pallet_ids_for_total(total_pallets))

    for fallback_idx, pack in enumerate(packs, start=1):
        pallet_number = str(pack.carton_index or fallback_idx) if preserve_pack_pallets else "1"
        if preserve_pack_pallets and allowed_pallets and pallet_number not in allowed_pallets:
            # Keep real XML order, but do not create impossible pallet numbers when
            # TD102 and P-loop count disagree. User can still edit the draft.
            pallet_number = str(fallback_idx)

        for item in pack.items:
            upc = item.upc or item.retailer_item or item.vendor_item
            case_upc = _derive_case_upc(item)
            description = item.description or ""
            lot = item.lot or pack.lot or ""
            expiration_date = item.expiration_date or pack.expiration_date or ""
            uom = _display_uom(item.uom)
            key = (pallet_number if preserve_pack_pallets else "", upc, case_upc, description, lot, expiration_date, uom)

            if key not in aggregated:
                line_no = len(aggregated) + 1
                if not upc:
                    warnings.append(f"Line {line_no}: missing item UPC")
                if not item.qty:
                    warnings.append(f"Line {line_no}: missing quantity")
                if not expiration_date:
                    warnings.append(f"Line {line_no}: missing expiration date")

                aggregated[key] = {
                    "line": line_no,
                    "location_on_pallet": pallet_number,
                    "item_number": upc,
                    "upc": upc,
                    "case_upc": case_upc,
                    "description": description,
                    "lot": lot,
                    "expiration_date": expiration_date,
                    "uom": uom,
                    "gtin": case_upc or upc,
                    "sku": item.vendor_item or item.retailer_item,
                    "packaging_level": "",
                    "dimensions_in": "",
                    "unit_weight_lbs": "",
                    "calculated_weight_lbs": "",
                    "qty_on_pallet": 0,
                    "total_ordered": 0,
                    "total_shipped": 0,
                    "pallet_weight": "",
                    "notes": "",
                    "source_sscc": normalize_sscc(pack.sscc),
                }

            qty = int(item.qty or 0)
            aggregated[key]["qty_on_pallet"] += qty
            aggregated[key]["total_ordered"] += qty
            aggregated[key]["total_shipped"] += qty

    rows = list(aggregated.values())
    for idx, row in enumerate(rows, start=1):
        row["line"] = idx
        for key in ("qty_on_pallet", "total_ordered", "total_shipped"):
            row[key] = str(row[key]) if row[key] else ""
    return rows


# ===========================================================================
# Product master / GTIN packaging helpers
# ===========================================================================

_PACKAGING_LEVELS = {"CASE": "Case", "INNER PACK": "Inner Pack", "EACH": "Each", "OTHER": "Other"}


def _only_digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def _canonical_id(value: Any) -> str:
    digits = _only_digits(value)
    return digits.lstrip("0") or digits


def _gtin14(value: Any) -> str:
    digits = _only_digits(value)
    if len(digits) == 14:
        return digits
    if len(digits) > 14:
        return digits[-14:]
    if len(digits) == 13:
        return "0" + digits
    return digits


def _normalize_packaging_level(value: Any) -> str:
    raw = re.sub(r"\s+", " ", str(value or "").strip()).upper()
    if raw in ("INNER", "INNERPACK", "IP"):
        raw = "INNER PACK"
    if raw in ("MASTER PACK", "MASTER", "MP", "CASE PACK"):
        raw = "CASE"
    return _PACKAGING_LEVELS.get(raw, "Other")


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on", "checked"}


def _parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(value).replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _format_lbs(value: Optional[float]) -> str:
    if value is None:
        return ""
    if abs(value - round(value)) < 0.005:
        return f"{int(round(value))} lbs"
    return f"{value:.2f}".rstrip("0").rstrip(".") + " lbs"


def _normalize_product_master_rows(rows: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not rows:
        return out
    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        gtin = str(row.get("gtin") or row.get("GTIN") or row.get("case_upc") or row.get("upc") or "").strip()
        desc = str(row.get("description") or row.get("DESCRIPTION") or "").strip()
        packaging_level = _normalize_packaging_level(row.get("packaging_level") or row.get("packging_level") or row.get("PACKGING LEVEL") or row.get("PACKAGING LEVEL"))
        dims = str(row.get("dimensions_in") or row.get("lwh_in") or row.get("L X W X H (in)") or row.get("dimensions") or "").strip()
        weight = str(row.get("weight_lbs") or row.get("WEIGHT(lbs)") or row.get("weight") or "").strip()
        sku = str(row.get("sku") or row.get("SKU") or "").strip()
        if not any([gtin, desc, dims, weight, sku]) and packaging_level == "Other":
            continue
        out.append({
            "line": row.get("line") or idx,
            "gtin": gtin,
            "description": desc,
            "packaging_level": packaging_level,
            "dimensions_in": dims,
            "weight_lbs": weight,
            "sku": sku,
        })
    return out


def _product_master_lookup(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for row in _normalize_product_master_rows(rows):
        for value in (row.get("gtin"), row.get("sku")):
            key = _canonical_id(value)
            if key:
                lookup.setdefault(key, row)
        sku_key = str(row.get("sku") or "").strip().lower()
        if sku_key:
            lookup.setdefault("sku:" + sku_key, row)
    return lookup


def _match_product_master_row(item: Dict[str, Any], rows: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    lookup = _product_master_lookup(rows)
    candidates = [
        item.get("gtin"), item.get("case_upc"), item.get("upc"), item.get("item_number"), item.get("sku"),
    ]
    for value in candidates:
        key = _canonical_id(value)
        if key and key in lookup:
            return lookup[key]
        sku_key = str(value or "").strip().lower()
        if sku_key and ("sku:" + sku_key) in lookup:
            return lookup["sku:" + sku_key]
    desc = _normalize(item.get("description") or "")
    if desc:
        for row in _normalize_product_master_rows(rows):
            if _normalize(row.get("description") or "") == desc:
                return row
    return None


def _qty_value(value: Any) -> float:
    parsed = _parse_float(value)
    return parsed if parsed is not None else 0.0


def _apply_product_row_to_item(item: Dict[str, Any], product: Dict[str, Any]) -> None:
    if product.get("gtin"):
        item["gtin"] = product.get("gtin", "")
    if product.get("sku"):
        item["sku"] = product.get("sku", "")
    if product.get("description") and not _mpl_clean(item.get("description")):
        item["description"] = product.get("description", "")
    item["packaging_level"] = product.get("packaging_level", "")
    item["dimensions_in"] = product.get("dimensions_in", "")
    item["unit_weight_lbs"] = product.get("weight_lbs", "")
    unit_weight = _parse_float(product.get("weight_lbs"))
    if unit_weight is not None:
        item["calculated_weight_lbs"] = _format_lbs(unit_weight * _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty")))


def apply_product_master_to_mpl_draft(draft: Dict[str, Any], *, force: bool = False) -> Dict[str, Any]:
    """Fill MPL line-item metadata and blank pallet weights from product master rows.

    Manual pallet weights are preserved unless force=True. Frontend users can still
    override the generated values before rendering.
    """
    product_rows = _normalize_product_master_rows(draft.get("product_master") or draft.get("product_master_rows") or [])
    if not product_rows:
        return draft
    draft["product_master"] = product_rows

    for mpl in draft.get("packing_lists") or []:
        items = mpl.get("items") or []
        pallet_totals: Dict[str, float] = {}
        for item in items:
            product = _match_product_master_row(item, product_rows)
            if not product:
                continue
            _apply_product_row_to_item(item, product)
            unit_weight = _parse_float(product.get("weight_lbs"))
            if unit_weight is None:
                continue
            pallet = _mpl_pallet_value(item)
            pallet_totals[pallet] = pallet_totals.get(pallet, 0.0) + unit_weight * _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty"))

        if pallet_totals:
            if not isinstance(mpl.get("_pallet_weights"), dict):
                mpl["_pallet_weights"] = {}
            for pallet, total in pallet_totals.items():
                calculated = _format_lbs(total)
                if force or not _mpl_clean(mpl["_pallet_weights"].get(pallet)):
                    mpl["_pallet_weights"][pallet] = calculated
                for item in items:
                    if _mpl_pallet_value(item) == pallet and (force or not _mpl_clean(item.get("pallet_weight"))):
                        item["pallet_weight"] = mpl["_pallet_weights"].get(pallet) or calculated
    return draft


def _extracted_rows_from_shipments(shipments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    headers: List[Dict[str, Any]] = []
    items: List[Dict[str, Any]] = []
    for ship in shipments:
        header = ship.get("header", {})
        dc_info = ship.get("dc_info")
        packs = ship.get("packs") or []
        headers.append({
            "document_type": "KeHE XML",
            "status": "Needs Review" if ship.get("needs_review") else "Ready",
            "source_file": header.get("source_file", ""),
            "dc": dc_info.get("dc", "") if dc_info else "Unknown",
            "dc_name": dc_info.get("name", "") if dc_info else "",
            "ship_to_gln": header.get("ship_to_gln", ""),
            "customer_po_numbers": header.get("customer_po_number", ""),
            "po_date": header.get("po_date", ""),
            "order_no": header.get("order_no", ""),
            "vendor_number": header.get("vendor_number", ""),
            "bsn": header.get("bsn", ""),
            "ship_date": header.get("ship_date", ""),
            "expected_delivery_date": header.get("expected_delivery_date", ""),
            "carrier": header.get("carrier", ""),
            "pro_number": header.get("pro_number", ""),
            "bol_number": header.get("bol_number", ""),
            "carton_count": header.get("carton_count", ""),
            "pack_count": header.get("pack_count", ""),
            "item_rows": sum(len(pack.items or []) for pack in packs),
            "total_weight": header.get("total_weight", ""),
            "cube": header.get("cube", ""),
            "total_pallets": header.get("total_pallets", ""),
            "ship_via": header.get("carrier", ""),
            "xml_ship_to": _addr_dict_to_str(header.get("xml_ship_to", {})) if header.get("xml_ship_to") else "",
            "final_ship_to": _ship_to_str(dc_info, header.get("xml_ship_to", {})),
            "ship_from": _ship_from_str(header, packs),
            "warnings": "; ".join(header.get("warnings", [])),
        })
        for pack_index, pack in enumerate(packs, start=1):
            for line, item in enumerate(pack.items or [], start=1):
                items.append({
                    "source_file": header.get("source_file", ""),
                    "dc": dc_info.get("dc", "") if dc_info else "Unknown",
                    "po": item.retailer_item or pack.po or header.get("customer_po_number", ""),
                    "customer_po_number": pack.po or header.get("customer_po_number", ""),
                    "carton": str(pack.carton_index or pack_index),
                    "sscc": normalize_sscc(pack.sscc),
                    "line": line,
                    "location_on_pallet": str(pack.carton_index or pack_index),
                    "item_number": item.upc or item.retailer_item or item.vendor_item,
                    "upc": item.upc,
                    "case_upc": _derive_case_upc(item),
                    "description": item.description,
                    "qty": str(item.qty or ""),
                    "uom": _display_uom(item.uom),
                    "lot": item.lot or pack.lot,
                    "expiration_date": item.expiration_date or pack.expiration_date,
                    "manufacture_date": item.manufacture_date,
                    "plant": item.plant or pack.plant,
                })
    return headers, items


def build_kehe_master_packing_list_draft(xml_paths: List[str], product_master_rows: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Parse XML files and return an editable master packing list draft."""
    if not xml_paths:
        raise ValueError("At least one XML file is required.")

    result = build_document_shipments(xml_paths)
    shipments = result["shipments"]
    duplicate_files = result["duplicate_files"]

    global_warnings: List[str] = []
    if duplicate_files:
        global_warnings.append(
            f"Duplicate file(s) skipped: {', '.join(duplicate_files)}"
        )

    packing_lists = []
    needs_review_count = 0

    for idx, ship in enumerate(shipments, start=1):
        header = ship["header"]
        dc_info = ship["dc_info"]
        packs = ship["packs"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        total_pallets = header.get("total_pallets") or header.get("xml_total_pallets") or "1"
        pallet_ids = _pallet_ids_for_total(total_pallets)

        mpl_warnings: List[str] = list(header.get("warnings", []))
        if not header.get("xml_total_pallets"):
            mpl_warnings.append(
                "Pallet count was not explicitly provided as TD101=PLT in XML. Defaulted to 1; edit Total Pallets/Pallet # if needed."
            )

        ship_from = _ship_from_str(header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)

        # Correct XML with TD101=PLT means each P-loop/SSCC is a pallet.
        # Preserve that parent/child XML relationship. Do not round-robin distribute
        # aggregated item rows across pallets.
        preserve_pack_pallets = bool(header.get("xml_total_pallets")) and _safe_positive_int(total_pallets, 1) > 1
        if preserve_pack_pallets and len(packs) != _safe_positive_int(total_pallets, 1):
            mpl_warnings.append(
                f"XML says Total Pallets={total_pallets}, but {len(packs)} P-loop/SSCC pallet records were found. Verify pallet grouping."
            )
        items = _aggregate_mpl_items_for_editor(
            packs,
            mpl_warnings,
            total_pallets=total_pallets,
            preserve_pack_pallets=preserve_pack_pallets,
        )
        if not items:
            raise ValueError(
                f"No item rows found in {header['source_file']}. "
                "Cannot generate Master Packing List."
            )

        packing_lists.append({
            "id": f"MPL-{idx}",
            "status": "Needs Review" if needs_review else "Ready",
            "dc": dc_info["dc"] if dc_info else "Unknown",
            "title": "MASTER PACKING LIST",
            "customer_po_number": header.get("customer_po_number", ""),
            "customer_no": header.get("customer_po_number", ""),
            "pro_number": header.get("pro_number", ""),
            "bol_number": header.get("bol_number", ""),
            "order_no": header.get("order_no", ""),
            "po_date": header.get("po_date", ""),
            "page_no": "1",
            "total_weight": header.get("total_weight", ""),
            "carton_count": header.get("carton_count") or header.get("pack_count", ""),
            "pack_count": header.get("pack_count", ""),
            "td1_package_code": header.get("td1_package_code", ""),
            "ship_via": header.get("carrier", ""),
            "total_pallets": str(_safe_positive_int(total_pallets, 1)),
            "_pallet_ids": pallet_ids,
            "_pallet_weights": {},
            "supplier_info": ship_from,
            "bill_to": billing,
            "ship_to": ship_to,
            "est_ship_date": header.get("ship_date", ""),
            "expected_delivery_date": header.get("expected_delivery_date", ""),
            "shipping_instructions": "",
            "source_files": [header["source_file"]],
            "warnings": mpl_warnings,
            "items": items,
        })

    draft = {
        "document_type": "kehe_master_packing_list",
        "version": 4,
        "summary": {
            "xml_files": len(xml_paths),
            "packing_lists": len(packing_lists),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "product_master": _normalize_product_master_rows(product_master_rows or []),
        "packing_lists": packing_lists,
    }
    if product_master_rows:
        apply_product_master_to_mpl_draft(draft, force=True)
    return draft

# ===========================================================================
# PDF rendering helpers
# ===========================================================================

# App-theme color palette
_COLOR_NEEDS_REVIEW_FILL = (0xfe / 255, 0xf2 / 255, 0xf2 / 255)   # #fef2f2
_COLOR_NEEDS_REVIEW_BORDER = (0xfe / 255, 0xca / 255, 0xca / 255)  # #fecaca
_COLOR_NEEDS_REVIEW_TEXT = (0xb9 / 255, 0x1c / 255, 0x1c / 255)    # #b91c1c

_COLOR_HEADER_BG = (0xf8 / 255, 0xfa / 255, 0xfc / 255)  # #f8fafc
_COLOR_BORDER = (0xe2 / 255, 0xe8 / 255, 0xf0 / 255)     # #e2e8f0
_COLOR_LABEL = (0x64 / 255, 0x74 / 255, 0x8b / 255)      # #64748b (slate)


def _draw_text_block(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    max_width: float,
    font_name: str = "Helvetica",
    font_size: float = 8,
    leading: float = 10,
    max_lines: int = 20,
    color: Tuple[float, float, float] = (0, 0, 0),
) -> float:
    """Draw wrapped multi-line text, return y after last line."""
    c.setFillColorRGB(*color)
    c.setFont(font_name, font_size)
    lines = text.split("\n") if text else []
    rendered = 0
    for line in lines:
        if rendered >= max_lines:
            break
        wrapped = wrap_text(line, font_name, font_size, max_width, max_lines=1)
        if wrapped:
            c.drawString(x, y, wrapped[0])
        else:
            pass  # blank line — still advance y
        y -= leading
        rendered += 1
    return y


def _draw_label_value(
    c: canvas.Canvas,
    label: str,
    value: str,
    x: float,
    y: float,
    max_width: float,
    label_size: float = 7,
    value_size: float = 9,
    leading: float = 11,
    value_leading: float = 10,
    color: Tuple[float, float, float] = (0, 0, 0),
) -> float:
    """Draw a LABEL line followed by value text, return y after."""
    c.setFont("Helvetica-Bold", label_size)
    c.setFillColorRGB(*_COLOR_LABEL)
    c.drawString(x, y, label.upper())
    y -= leading
    c.setFillColorRGB(*color)
    c.setFont("Helvetica-Bold", value_size)
    lines = (value or "—").split("\n")
    for line in lines:
        wrapped = wrap_text(line, "Helvetica-Bold", value_size, max_width, max_lines=1)
        c.drawString(x, y, wrapped[0] if wrapped else "")
        y -= value_leading
    return y


def _draw_rect_with_fill(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    fill_rgb: Tuple[float, float, float],
    stroke_rgb: Tuple[float, float, float],
    line_width: float = 0.5,
) -> None:
    c.setFillColorRGB(*fill_rgb)
    c.setStrokeColorRGB(*stroke_rgb)
    c.setLineWidth(line_width)
    c.rect(x, y, w, h, fill=1, stroke=1)


def _draw_warning_box(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    w: float,
    font_size: float = 7.5,
    padding: float = 6,
) -> float:
    """Draw a red warning box, return bottom y coordinate."""
    lines = [ln for ln in text.split("\n") if ln.strip()]
    leading = font_size + 2
    box_h = padding * 2 + len(lines) * leading
    by = y - box_h
    _draw_rect_with_fill(
        c, x, by, w, box_h,
        _COLOR_NEEDS_REVIEW_FILL,
        _COLOR_NEEDS_REVIEW_BORDER,
        line_width=0.75,
    )
    ty = y - padding - font_size
    c.setFont("Helvetica-Bold", font_size)
    c.setFillColorRGB(*_COLOR_NEEDS_REVIEW_TEXT)
    for line in lines:
        wrapped = wrap_text(line, "Helvetica-Bold", font_size, w - padding * 2, max_lines=1)
        c.drawString(x + padding, ty, wrapped[0] if wrapped else "")
        ty -= leading
    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    return by


# ===========================================================================
# Pallet Label renderer
# ===========================================================================

def _render_pallet_label_page(c: canvas.Canvas, pallet: Dict[str, Any]) -> None:
    """Render one Pallet Placard page at standard 4 x 6 inch size.

    Updated layout:
      - PALLET PLACARD title
      - DATE label with boxed value
      - SHIP FROM label with boxed multiline value
      - SHIP TO label with boxed multiline value
      - PALLET # row with large boxed X and Y values
      - KEHE PO#S ON THIS PALLET header box
      - PO# label with boxed PO value(s)
      - compact warning box only when needed
    """
    W, H = 4 * inch, 6 * inch
    margin = 0.16 * inch
    x0 = margin
    y0 = margin
    inner_w = W - 2 * margin
    inner_h = H - 2 * margin
    y_top = y0 + inner_h

    needs_review = pallet.get("status") == "Needs Review"
    pad = 0.06 * inch

    # Compact but cleaner row sizing to reduce empty bottom space.
    title_h = 0.40 * inch
    date_h = 0.40 * inch
    from_h = 0.92 * inch
    to_h = 1.18 * inch
    pallet_h = 0.52 * inch
    po_hdr_h = 0.30 * inch
    warn_h = 0.34 * inch if needs_review else 0.0

    used_h = title_h + date_h + from_h + to_h + pallet_h + po_hdr_h + warn_h
    po_val_h = max(0.70 * inch, inner_h - used_h)

    # Row bottoms
    title_bot = y_top - title_h
    date_bot = title_bot - date_h
    from_bot = date_bot - from_h
    to_bot = from_bot - to_h
    pallet_bot = to_bot - pallet_h
    po_hdr_bot = pallet_bot - po_hdr_h
    po_val_bot = po_hdr_bot - po_val_h

    # Outer border
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.0)
    c.rect(x0, y0, inner_w, inner_h)

    label_w = 0.95 * inch
    box_x = x0 + label_w
    box_w = inner_w - label_w - pad * 0.3

    def _normalize_date(value: str) -> str:
        return _format_edi_date(value or "")

    def _draw_left_label(y_mid: float, text: str, size: float = 10.5) -> None:
        c.setFont("Helvetica-Bold", size)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(x0 + 0.02 * inch, y_mid - size * 0.30, text)

    def _draw_box(x: float, y: float, w: float, h: float, line_width: float = 0.8) -> None:
        c.setLineWidth(line_width)
        c.setStrokeColorRGB(0, 0, 0)
        c.rect(x, y, w, h)

    def _draw_multiline_centered_box(
        x: float,
        y: float,
        w: float,
        h: float,
        text: str,
        font_name: str = "Helvetica-Bold",
        font_size: float = 10.0,
        leading: float = 11.5,
        padding: float = 5,
        max_lines: int = 8,
    ) -> None:
        _draw_box(x, y, w, h)
        raw_lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
        wrapped_lines: List[str] = []
        for ln in raw_lines:
            wrapped_lines.extend(wrap_text(ln, font_name, font_size, w - 2 * padding, max_lines=max_lines))
        if not wrapped_lines:
            wrapped_lines = [""]

        if len(wrapped_lines) > max_lines:
            wrapped_lines = wrapped_lines[:max_lines]

        total_h = len(wrapped_lines) * leading
        ty = y + (h + total_h) / 2 - leading * 0.82

        c.setFont(font_name, font_size)
        c.setFillColorRGB(0, 0, 0)
        for line in wrapped_lines:
            c.drawCentredString(x + w / 2, ty, line)
            ty -= leading

    def _draw_single_line_box(
        x: float,
        y: float,
        w: float,
        h: float,
        text: str,
        font_name: str = "Helvetica-Bold",
        font_size: float = 11.0,
    ) -> None:
        _draw_box(x, y, w, h)
        c.setFont(font_name, font_size)
        c.setFillColorRGB(0, 0, 0)
        c.drawCentredString(x + w / 2, y + h / 2 - font_size * 0.34, text or "")

    # 1) Title
    _draw_rect_with_fill(c, x0, title_bot, inner_w, title_h, (0, 0, 0), (0, 0, 0), 1.0)
    c.setFont("Helvetica-Bold", 15)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(x0 + inner_w / 2, title_bot + title_h / 2 - 5.2, "PALLET PLACARD")

    # 2) Date row
    date_val = _normalize_date(pallet.get("expected_delivery_date") or pallet.get("date", ""))
    _draw_left_label(date_bot + date_h / 2, "DATE:", 10.5)
    _draw_single_line_box(
        box_x,
        date_bot + 0.03 * inch,
        box_w,
        date_h - 0.06 * inch,
        date_val,
        font_name="Helvetica-Bold",
        font_size=11.0,
    )

    # 3) Ship From box
    _draw_left_label(from_bot + from_h - 0.14 * inch, "SHIP FROM:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        from_bot + 0.03 * inch,
        box_w,
        from_h - 0.06 * inch,
        pallet.get("ship_from", ""),
        font_name="Helvetica-Bold",
        font_size=10.0,
        leading=11.5,
        padding=5,
        max_lines=5,
    )

    # 4) Ship To box
    _draw_left_label(to_bot + to_h - 0.14 * inch, "SHIP TO:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        to_bot + 0.03 * inch,
        box_w,
        to_h - 0.06 * inch,
        pallet.get("ship_to", ""),
        font_name="Helvetica-Bold",
        font_size=10.0,
        leading=11.3,
        padding=5,
        max_lines=6,
    )

    # 5) Pallet count row
    row_y = pallet_bot + pallet_h / 2

    c.setFont("Helvetica-Bold", 11)
    c.setFillColorRGB(0, 0, 0)
    c.drawString(x0 + 0.02 * inch, row_y - 4, "PALLET #")

    num_box_w = 0.42 * inch
    num_box_h = 0.28 * inch

    x_box_1 = x0 + 1.28 * inch
    x_of = x_box_1 + num_box_w + 0.13 * inch
    x_box_2 = x_of + 0.34 * inch
    x_total = x_box_2 + num_box_w + 0.14 * inch

    _draw_single_line_box(
        x_box_1,
        pallet_bot + 0.12 * inch,
        num_box_w,
        num_box_h,
        str(pallet.get("pallet_number", "1")),
        font_name="Helvetica-Bold",
        font_size=13.0,
    )

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_of, row_y - 4, "OF")

    _draw_single_line_box(
        x_box_2,
        pallet_bot + 0.12 * inch,
        num_box_w,
        num_box_h,
        str(pallet.get("total_pallets", "1")),
        font_name="Helvetica-Bold",
        font_size=13.0,
    )

    c.setFont("Helvetica-Bold", 11)
    c.drawString(x_total, row_y - 4, "TOTAL")

    # 6) PO header box
    _draw_box(x0, po_hdr_bot, inner_w, po_hdr_h, line_width=0.9)
    c.setFont("Helvetica-Bold", 10.5)
    c.drawCentredString(
        x0 + inner_w / 2,
        po_hdr_bot + po_hdr_h / 2 - 3.6,
        "KEHE PO#S ON THIS PALLET:"
    )

    # 7) PO value box
    po_raw = str(pallet.get("customer_po_numbers", "") or "")
    po_lines = [p.strip() for p in re.split(r"[,\n;]+", po_raw) if p.strip()]
    po_text = "\n".join(po_lines) if po_lines else po_raw

    _draw_left_label(po_val_bot + po_val_h - 0.16 * inch, "PO#:", 10.5)
    _draw_multiline_centered_box(
        box_x,
        po_val_bot + 0.04 * inch,
        box_w,
        po_val_h - 0.08 * inch,
        po_text,
        font_name="Helvetica-Bold",
        font_size=11.0,
        leading=12.0,
        padding=5,
        max_lines=6,
    )

    # 8) Warning box only when needed
    if needs_review and warn_h > 0:
        _draw_warning_box(
            c,
            "NEEDS REVIEW — Verify Ship-To before printing.",
            x0 + 0.02 * inch,
            po_val_bot,
            inner_w - 0.04 * inch,
            font_size=6.3,
            padding=3,
        )

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    
def render_kehe_pallet_label_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Pallet Placard pages from an edited draft.

    Each pallet entry is rendered `copies` times (default 2).
    Returns a report dict suitable for the frontend report panel.
    """
    pallets = draft.get("pallets") or []
    if not pallets:
        raise ValueError("Draft contains no pallets to render.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(4 * inch, 6 * inch))

    total_pages = 0
    rows = []
    needs_review_count = 0

    for pallet in pallets:
        # Validate / sanitize user-edited copies field
        try:
            copies = max(1, int(str(pallet.get("copies") or "2").strip() or "2"))
        except (ValueError, TypeError):
            copies = 1
            pallet.setdefault("warnings", [])
            pallet["warnings"].append("'copies' was invalid; defaulted to 1.")

        try:
            total_pallets_val = str(int(str(pallet.get("total_pallets") or "1").strip() or "1"))
        except (ValueError, TypeError):
            total_pallets_val = "1"
            pallet.setdefault("warnings", [])
            pallet["warnings"].append("'total_pallets' was invalid; defaulted to 1.")
        pallet["total_pallets"] = total_pallets_val

        status = pallet.get("status", "Ready")
        if not pallet.get("ship_to", "").strip():
            status = "Needs Review"
            pallet["status"] = status
        if not pallet.get("customer_po_numbers", "").strip():
            status = "Needs Review"
            pallet["status"] = status

        if status == "Needs Review":
            needs_review_count += 1

        if progress_callback:
            progress_callback(
                f"Rendering pallet {pallet.get('id', '')} "
                f"({copies} {'copy' if copies == 1 else 'copies'})…"
            )

        for _ in range(copies):
            _render_pallet_label_page(c, pallet)
            c.showPage()
            total_pages += 1

        # Ship-to display name for report
        ship_to_lines = (pallet.get("ship_to") or "").split("\n")
        ship_to_display = ship_to_lines[0] if ship_to_lines else "—"

        rows.append({
            "document": "Pallet Label",
            "status": status,
            "dc": pallet.get("dc", ""),
            "po": pallet.get("customer_po_numbers", ""),
            "pallet": f"{pallet.get('pallet_number', '1')} of {pallet.get('total_pallets', '1')}",
            "copies": copies,
            "ship_to": ship_to_display,
            "note": "Generated from edited draft",
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "pallets": len(pallets),
            "pages": total_pages,
            "needs_review": needs_review_count,
        },
        "rows": rows,
    }



# ===========================================================================
# Master Pack / Inner Pack 4 x 4 ITF-14 label renderer
# ===========================================================================

_PACK_LABEL_PAGE = (4 * inch, 4 * inch)


def _pack_label_kind(packaging_level: str) -> str:
    level = _normalize_packaging_level(packaging_level)
    if level == "Inner Pack":
        return "IP"
    if level == "Case":
        return "MP"
    return "OTHER"


def _best_xml_match_for_product(product: Dict[str, Any], extracted_items: List[Dict[str, Any]]) -> Dict[str, Any]:
    for item in extracted_items:
        if _match_product_master_row(item, [product]):
            return item
    return {}


def build_kehe_pack_label_draft(
    xml_paths: List[str],
    product_master_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Parse XML and product master rows into editable 4 x 4 pack label drafts."""
    if not xml_paths:
        raise ValueError("At least one XML file is required.")

    result = build_document_shipments(xml_paths)
    shipments = result["shipments"]
    duplicate_files = result["duplicate_files"]
    extracted_headers, extracted_items = _extracted_rows_from_shipments(shipments)
    product_rows = _normalize_product_master_rows(product_master_rows or [])

    if not product_rows:
        # Seed editable rows from XML so the frontend can still open the editor.
        seen: set[str] = set()
        for item in extracted_items:
            gtin = item.get("case_upc") or item.get("upc") or item.get("item_number") or ""
            key = _canonical_id(gtin) or _normalize(item.get("description") or "")
            if not key or key in seen:
                continue
            seen.add(key)
            product_rows.append({
                "line": len(product_rows) + 1,
                "gtin": gtin,
                "description": item.get("description", ""),
                "packaging_level": "Other",
                "dimensions_in": "",
                "weight_lbs": "",
                "sku": item.get("item_number", ""),
            })

    labels: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if duplicate_files:
        warnings.append(f"Duplicate file(s) skipped: {', '.join(duplicate_files)}")

    for product in product_rows:
        level = _normalize_packaging_level(product.get("packaging_level"))
        kind = _pack_label_kind(level)
        if kind not in ("MP", "IP"):
            continue
        xml_item = _best_xml_match_for_product(product, extracted_items)
        matched_in_xml = bool(xml_item)
        label_warnings: List[str] = []
        gtin = _gtin14(product.get("gtin"))
        if len(_only_digits(gtin)) != 14:
            label_warnings.append("GTIN must be 14 digits for ITF-14.")
        if not product.get("description"):
            label_warnings.append("Description is blank.")
        if not product.get("weight_lbs"):
            label_warnings.append("Weight is blank.")
        qty = str(xml_item.get("qty") or xml_item.get("qty_on_pallet") or xml_item.get("total_shipped") or "").strip()
        if not matched_in_xml:
            label_warnings.append("Not matched in uploaded XML; check Print only if you want this label.")
        elif not qty:
            label_warnings.append("Case quantity was not found in XML; edit before printing if needed.")
        label = {
            "id": f"PACK-{len(labels) + 1}",
            "status": "Needs Review" if label_warnings else "Ready",
            "print_selected": matched_in_xml,
            "matched_in_xml": matched_in_xml,
            "gtin": gtin,
            "description": product.get("description", ""),
            "brand": "BREW GLITTER",
            "packaging_level": level,
            "pack_prefix": kind,
            "dimensions_in": product.get("dimensions_in", ""),
            "weight_lbs": product.get("weight_lbs", ""),
            "sku": product.get("sku", ""),
            "lot": xml_item.get("lot", ""),
            "best_before": xml_item.get("expiration_date", ""),
            "case_qty": qty,
            "copies": 1,
            "source_file": xml_item.get("source_file", ""),
            "warnings": label_warnings,
        }
        labels.append(label)

    return {
        "document_type": "kehe_pack_labels",
        "version": 1,
        "summary": {
            "xml_files": len(xml_paths),
            "labels": len(labels),
            "selected_labels": sum(1 for label in labels if label.get("print_selected")),
            "matched_labels": sum(1 for label in labels if label.get("matched_in_xml")),
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": warnings,
        "product_master": product_rows,
        "extracted_headers": extracted_headers,
        "extracted_items": extracted_items,
        "pack_labels": labels,
    }


def _draw_itf14_centered(c: canvas.Canvas, gtin14: str, x: float, y: float, w: float, h: float) -> None:
    value = _only_digits(gtin14)
    if not value:
        return
    if len(value) % 2:
        value = "0" + value
    bar_width = 0.020 * inch
    drawing = createBarcodeDrawing("I2of5", value=value, barHeight=h, barWidth=bar_width, humanReadable=False)
    while drawing.width > w and bar_width > 0.006 * inch:
        bar_width *= 0.92
        drawing = createBarcodeDrawing("I2of5", value=value, barHeight=h, barWidth=bar_width, humanReadable=False)
    renderPDF.draw(drawing, c, x + (w - drawing.width) / 2, y)


def _draw_pack_label_page(c: canvas.Canvas, label: Dict[str, Any]) -> None:
    W, H = _PACK_LABEL_PAGE
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.2)
    c.rect(0.02 * inch, 0.02 * inch, W - 0.04 * inch, H - 0.04 * inch)

    desc = str(label.get("description") or "").upper().strip()
    brand = str(label.get("brand") or "BREW GLITTER").upper().strip()
    title_lines = wrap_text(desc, "Helvetica-Bold", 21, W - 0.36 * inch, max_lines=2)
    y = H - 0.36 * inch
    c.setFillColorRGB(0, 0, 0)
    for line in title_lines:
        c.setFont("Helvetica-Bold", 21)
        c.drawCentredString(W / 2, y, line)
        y -= 0.28 * inch
    c.setFont("Helvetica-Bold", 21)
    c.drawCentredString(W / 2, y, brand)

    lot = str(label.get("lot") or "").strip()
    best_before = _format_label_date_mmddyyyy(str(label.get("best_before") or ""))
    row_y = y - 0.38 * inch
    c.setFont("Helvetica-Bold", 13)
    c.drawString(0.34 * inch, row_y, f"LOT# {lot}" if lot else "LOT#")

    c.setFont("Helvetica-Bold", 13)
    c.drawString(1.95 * inch, row_y, "Best Before:")

    c.setFont("Helvetica", 13)
    c.drawString(3.02 * inch, row_y, best_before)

    weight = str(label.get("weight_lbs") or "").strip()
    weight_display = _format_lbs(_parse_float(weight)) if weight else ""
    weight_y = row_y - 0.40 * inch
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(2.10 * inch, weight_y, "WEIGHT:")
    c.setFont("Helvetica", 20)
    c.drawString(2.20 * inch, weight_y, weight_display or weight)

    kind = str(label.get("pack_prefix") or _pack_label_kind(label.get("packaging_level"))).upper()
    qty = str(label.get("case_qty") or "").strip()
    qty_y = weight_y - 0.34 * inch
    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(2.40 * inch, qty_y, f"{kind} Case Qty:")
    c.setFont("Helvetica", 20)
    c.drawString(2.50 * inch, qty_y, f"{qty} Units" if qty else "Units")

    # ITF-14 barcode on plain white background.
    bx = 0.31 * inch
    by = 0.42 * inch
    bw = W - 0.62 * inch
    bh = 1.12 * inch
    _draw_itf14_centered(
        c,
        label.get("gtin", ""),
        bx + 0.03 * inch,
        by + 0.03 * inch,
        bw - 0.06 * inch,
        bh - 0.06 * inch,
    )

    gtin = _only_digits(label.get("gtin", ""))
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 16)
    c.drawCentredString(W / 2, 0.22 * inch, " ".join(gtin) if gtin else "")


def render_kehe_pack_label_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render 4 x 4 Master Pack / Inner Pack ITF-14 labels from an edited draft."""
    labels = draft.get("pack_labels") or []
    if not labels:
        raise ValueError("Draft contains no Master Pack / Inner Pack labels to render.")

    selected_labels = [label for label in labels if _truthy(label.get("print_selected", label.get("selected", True)))]
    if not selected_labels:
        raise ValueError("No Pack Labels are selected to print. Check at least one Print checkbox in the Pack Labels editor.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=_PACK_LABEL_PAGE)
    rows: List[Dict[str, Any]] = []
    total_pages = 0
    needs_review = 0

    for label in selected_labels:
        gtin = _gtin14(label.get("gtin"))
        label["gtin"] = gtin
        warnings = label.setdefault("warnings", [])
        status = label.get("status", "Ready")
        if len(_only_digits(gtin)) != 14:
            status = "Needs Review"
            if "GTIN must be 14 digits for ITF-14." not in warnings:
                warnings.append("GTIN must be 14 digits for ITF-14.")
        if not str(label.get("description") or "").strip():
            status = "Needs Review"
            if "Description is blank." not in warnings:
                warnings.append("Description is blank.")
        label["status"] = status
        if status == "Needs Review":
            needs_review += 1
        try:
            copies = max(1, int(str(label.get("copies") or "1").strip() or "1"))
        except (ValueError, TypeError):
            copies = 1
        label["pack_prefix"] = str(label.get("pack_prefix") or _pack_label_kind(label.get("packaging_level"))).upper()
        if progress_callback:
            progress_callback(f"Rendering {label.get('id', 'pack label')} ({copies} copy{'ies' if copies != 1 else ''})...")
        for _ in range(copies):
            _draw_pack_label_page(c, label)
            c.showPage()
            total_pages += 1
        rows.append({
            "document": "Pack Label",
            "status": status,
            "gtin": label.get("gtin", ""),
            "description": label.get("description", ""),
            "packaging_level": label.get("packaging_level", ""),
            "weight_lbs": label.get("weight_lbs", ""),
            "case_qty": label.get("case_qty", ""),
            "copies": copies,
            "note": "; ".join(warnings) if warnings else "Generated from edited draft",
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "labels": len(selected_labels),
            "available_labels": len(labels),
            "pages": total_pages,
            "needs_review": needs_review,
        },
        "rows": rows,
    }

# ===========================================================================
# Master Packing List renderer
# ===========================================================================

# KeHE's MPL is intended for full-page printing. Use A4 to match the frontend
# preview and the customer's print process.
_MPL_PAGE_W, _MPL_PAGE_H = A4
_MPL_MARGIN = 0.32 * inch
_MPL_INNER_W = _MPL_PAGE_W - 2 * _MPL_MARGIN
_MPL_INNER_TOP = _MPL_PAGE_H - _MPL_MARGIN
_MPL_INNER_BOTTOM = _MPL_MARGIN

# Column definitions: (key, header label, relative_width)
_ITEM_COLUMNS: List[Tuple[str, str, float]] = [
    ("item_number",        "Item Number",                      0.17),
    ("_description_block", "Pallet Weight &\nItem Description", 0.39),
    ("uom",                "UOM",                              0.10),
    ("qty_on_pallet",      "Qty On\nPallet",                    0.11),
    ("total_ordered",      "Total\nOrdered",                    0.11),
    ("total_shipped",      "Total\nShipped",                    0.12),
]

_MPL_BLACK = (0, 0, 0)
_MPL_GRID = (0.30, 0.30, 0.30)
_MPL_GREY = (0.82, 0.82, 0.82)
_MPL_LIGHT_GREY = (0.90, 0.90, 0.90)
_MPL_CREAM = (0.98, 0.95, 0.82)
_MPL_ROW_ALT = (0.97, 0.97, 0.97)


def _mpl_clean(value: Any) -> str:
    return str(value or "").strip()


def _mpl_date_mmddyyyy(value: str) -> str:
    """Normalize MPL dates to MM/DD/YYYY."""
    v = _mpl_clean(value)
    if not v:
        return ""

    # Already MM/DD/YYYY or MM-DD-YYYY.
    m = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$", v)
    if m:
        mm = int(m.group(1))
        dd = int(m.group(2))
        yy = m.group(3)
        year = int(yy) + 2000 if len(yy) == 2 else int(yy)
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    # YYYY-MM-DD or YYYY/MM/DD.
    m = re.match(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$", v)
    if m:
        year = int(m.group(1))
        mm = int(m.group(2))
        dd = int(m.group(3))
        return f"{mm:02d}/{dd:02d}/{year:04d}"

    digits = re.sub(r"\D", "", v)
    if len(digits) == 8:
        first4 = int(digits[:4])
        last4 = int(digits[4:8])

        # YYYYMMDD
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"

        # MMDDYYYY
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"

    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"

    return v


def _mpl_date_short(value: str) -> str:
    """Display MPL header dates as MM/DD/YYYY."""
    return _mpl_date_mmddyyyy(value)


def _mpl_exp_short(value: str) -> str:
    """Display MPL item expiration dates as MM/DD/YYYY."""
    return _mpl_date_mmddyyyy(value)

def _mpl_weight_label(raw: Any) -> str:
    v = _mpl_clean(raw)
    if not v:
        return ""
    if re.search(r"\b(lb|lbs|pound|pounds)\b", v, re.I):
        return v.upper().replace("POUNDS", "LBS").replace("POUND", "LBS")
    return f"{v} LBS"


def _mpl_pallet_value(item: Dict[str, Any]) -> str:
    return _mpl_clean(item.get("location_on_pallet")) or "1"


def _mpl_pallet_sort_key(value: str) -> Tuple[int, Any]:
    v = _mpl_clean(value)
    m = re.search(r"\d+", v)
    if m:
        return (0, int(m.group(0)))
    return (1, v.lower())


def _mpl_pallet_label(value: str) -> str:
    v = _mpl_clean(value)
    m = re.search(r"\d+", v)
    return m.group(0) if m else (v or "1")


def _mpl_group_items(items: List[Dict[str, Any]]) -> List[Tuple[str, List[Dict[str, Any]]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for item in items:
        pallet = _mpl_pallet_value(item)
        groups.setdefault(pallet, []).append(item)
    return sorted(groups.items(), key=lambda pair: _mpl_pallet_sort_key(pair[0]))


def _mpl_prepare_items(mpl: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = list(mpl.get("items") or [])
    for idx, item in enumerate(items, start=1):
        item["line"] = item.get("line") or idx
        item["location_on_pallet"] = _mpl_pallet_value(item)
        if not _mpl_clean(item.get("qty_on_pallet")):
            item["qty_on_pallet"] = item.get("total_shipped") or item.get("qty") or ""
        if not _mpl_clean(item.get("total_ordered")):
            item["total_ordered"] = item.get("qty_on_pallet") or item.get("total_shipped") or ""
        if not _mpl_clean(item.get("total_shipped")):
            item["total_shipped"] = item.get("qty_on_pallet") or ""
    max_pallet_num = 1
    for pallet, _rows in _mpl_group_items(items):
        m = re.search(r"\d+", pallet)
        if m:
            max_pallet_num = max(max_pallet_num, int(m.group(0)))
    declared = _safe_positive_int(mpl.get("total_pallets"), 1)
    mpl["total_pallets"] = str(max(declared, max_pallet_num))
    return items


def _mpl_col_widths() -> List[Tuple[str, str, float, float]]:
    out: List[Tuple[str, str, float, float]] = []
    x = _MPL_MARGIN
    for key, label, rel in _ITEM_COLUMNS:
        w = _MPL_INNER_W * rel
        out.append((key, label, x, w))
        x += w
    return out


def _draw_mpl_cell(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    fill_rgb: Tuple[float, float, float],
    stroke_rgb: Tuple[float, float, float] = _MPL_GRID,
    line_width: float = 0.35,
) -> None:
    c.setFillColorRGB(*fill_rgb)
    c.setStrokeColorRGB(*stroke_rgb)
    c.setLineWidth(line_width)
    c.rect(x, y, w, h, fill=1, stroke=1)


def _draw_wrapped_left(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    w: float,
    font_name: str,
    font_size: float,
    max_lines: int = 2,
    leading: float = 8,
) -> float:
    c.setFont(font_name, font_size)
    lines = wrap_text(_mpl_clean(text), font_name, font_size, w, max_lines=max_lines) or [""]
    for line in lines[:max_lines]:
        c.drawString(x, y, line)
        y -= leading
    return y


def _draw_centered_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y_mid: float,
    w: float,
    font_name: str,
    font_size: float,
    max_lines: int = 2,
    leading: float = 7.5,
) -> None:
    lines = wrap_text(_mpl_clean(text), font_name, font_size, w - 5, max_lines=max_lines) or [""]
    c.setFont(font_name, font_size)
    total = (len(lines) - 1) * leading
    ty = y_mid + total / 2 - font_size / 3
    for line in lines:
        c.drawCentredString(x + w / 2, ty, line)
        ty -= leading


def _draw_info_cell(c: canvas.Canvas, x: float, top_y: float, w: float, h: float, label: str, value: str) -> None:
    label_h = h * 0.42
    _draw_mpl_cell(c, x, top_y - h, w, h, _MPL_CREAM, _MPL_GRID, 0.4)
    _draw_mpl_cell(c, x, top_y - label_h, w, label_h, _MPL_GREY, _MPL_GRID, 0.4)

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 7.4)
    c.drawCentredString(x + w / 2, top_y - label_h / 2 - 2.6, label)

    _draw_centered_wrapped(
        c,
        value,
        x,
        top_y - h + (h - label_h) / 2,
        w,
        "Helvetica-Bold",
        8.0,
        max_lines=1,
        leading=8.5,
    )

def _render_mpl_header(c: canvas.Canvas, mpl: Dict[str, Any], page_num: int, total_pages: int) -> float:
    """Draw MPL header block; return y position below header."""
    x0 = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    y = _MPL_INNER_TOP

    # Title bar.
    title_h = 0.23 * inch
    _draw_mpl_cell(c, x0, y - title_h, inner_w, title_h, _MPL_BLACK, _MPL_BLACK, 0.6)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(x0 + inner_w / 2, y - title_h / 2 - 3.0, mpl.get("title") or "MASTER PACKING LIST")
    y -= title_h + 0.12 * inch

    if mpl.get("status") == "Needs Review":
        y = _draw_warning_box(
            c,
            "NEEDS REVIEW - Unknown KeHE DC. Verify addresses before using.",
            x0,
            y,
            inner_w,
            font_size=6.5,
            padding=4,
        ) - 0.05 * inch

    # Top requirement grid.
    def draw_info_row(cells: List[Tuple[str, str, float]], row_h: float = 0.28 * inch) -> None:
        nonlocal y
        cx = x0
        for label, value, rel_w in cells:
            cw = inner_w * rel_w
            _draw_info_cell(c, cx, y, cw, row_h, label, value)
            cx += cw
        y -= row_h

    draw_info_row([
        ("Customer PO Number", _mpl_clean(mpl.get("customer_po_number")), 0.50),
        ("Pro No", _mpl_clean(mpl.get("pro_number")), 0.50),
    ])
    draw_info_row([
        ("Order No", _mpl_clean(mpl.get("order_no")), 0.25),
        ("PO Date", _mpl_date_short(_mpl_clean(mpl.get("po_date"))), 0.25),
        ("BOL No", _mpl_clean(mpl.get("bol_number")), 0.25),
        ("Page No", f"Page {page_num} of {total_pages}", 0.25),
    ])
    draw_info_row([
        ("Total Weight", _mpl_clean(mpl.get("total_weight")), 0.34),
        ("Ship Via", _mpl_clean(mpl.get("ship_via")), 0.33),
        ("Total Pallets", _mpl_clean(mpl.get("total_pallets")), 0.33),
    ])

    y -= 0.16 * inch

    # Address blocks.
    addr_h = 0.93 * inch
    col_gap = 0.12 * inch
    col_w = (inner_w - 2 * col_gap) / 3
    addr_cells = [
        ("SUPPLIER INFO:", mpl.get("supplier_info", "")),
        ("BILL TO:", mpl.get("bill_to", "")),
        ("SHIP TO:", mpl.get("ship_to", "")),
    ]
    for idx, (label, value) in enumerate(addr_cells):
        cx = x0 + idx * (col_w + col_gap)
        _draw_mpl_cell(c, cx, y - addr_h, col_w, addr_h, _MPL_CREAM, _MPL_GRID, 0.35)
        header_h = 0.22 * inch
        _draw_mpl_cell(c, cx, y - header_h, col_w, header_h, _MPL_GREY, _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(cx + col_w / 2, y - header_h / 2 - 2.7, label)
        c.setFont("Helvetica", 6.8)
        lines: List[str] = []
        for raw in _mpl_clean(value).split("\n"):
            lines.extend(wrap_text(raw, "Helvetica", 6.8, col_w - 12, max_lines=2) or [""])
        ty = y - header_h - 0.12 * inch
        for line in lines[:5]:
            c.drawCentredString(cx + col_w / 2, ty, line)
            ty -= 8
    y -= addr_h + 0.16 * inch

    # Customer / Ship Date / Shipping Instructions bar.
    header_h = 0.18 * inch
    value_h = 0.28 * inch
    cells = [
        ("Customer No", _mpl_clean(mpl.get("customer_no") or mpl.get("customer_po_number")), 0.25),
        ("Ship Date", _mpl_date_short(_mpl_clean(mpl.get("est_ship_date"))), 0.25),
        ("Shipping Instructions", _mpl_clean(mpl.get("shipping_instructions")), 0.50),
    ]
    cx = x0
    for label, _value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - header_h, cw, header_h, _MPL_BLACK, _MPL_BLACK, 0.35)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 6.4)
        c.drawCentredString(cx + cw / 2, y - header_h / 2 - 2.3, label)
        cx += cw
    y -= header_h
    cx = x0
    for _label, value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - value_h, cw, value_h, _MPL_CREAM, _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        _draw_centered_wrapped(c, value, cx, y - value_h / 2, cw, "Helvetica", 7, max_lines=1)
        cx += cw
    y -= value_h + 0.22 * inch

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    return y


def _render_mpl_table_header(c: canvas.Canvas, y: float) -> float:
    th = 0.36 * inch
    _draw_mpl_cell(c, _MPL_MARGIN, y - th, _MPL_INNER_W, th, _MPL_BLACK, _MPL_BLACK, 0.45)

    c.setFillColorRGB(1, 1, 1)
    for _key, header_lbl, x, w in _mpl_col_widths():
        lines = header_lbl.split("\n")
        c.setFont("Helvetica-Bold", 7.4)
        line_h = 7.8
        ty = y - th / 2 + (len(lines) - 1) * line_h / 2 - 2.6

        for ln in lines:
            c.drawCentredString(x + w / 2, ty, ln)
            ty -= line_h

        c.setStrokeColorRGB(0.18, 0.18, 0.18)
        c.setLineWidth(0.35)
        c.line(x, y - th, x, y)

    c.line(_MPL_MARGIN + _MPL_INNER_W, y - th, _MPL_MARGIN + _MPL_INNER_W, y)
    c.setFillColorRGB(0, 0, 0)
    return y - th

def _mpl_item_height(item: Dict[str, Any]) -> float:
    desc = _mpl_clean(item.get("description"))
    desc_lines = (
        wrap_text(desc.upper(), "Helvetica-Bold", 7.8, _MPL_INNER_W * 0.39 - 10, max_lines=4)
        if desc else []
    )

    # A4 has enough height. Use taller rows instead of compressed rows.
    extra = max(0, len(desc_lines) - 1) * 0.13 * inch

    if _mpl_clean(item.get("expiration_date")):
        extra += 0.13 * inch

    return max(0.46 * inch, 0.42 * inch + extra)

def _render_mpl_item_row(c: canvas.Canvas, item: Dict[str, Any], y: float, row_h: float, bg_rgb: Tuple[float, float, float]) -> float:
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, bg_rgb, _MPL_GRID, 0.30)

    for key, _label, x, w in _mpl_col_widths():
        c.setStrokeColorRGB(_MPL_GRID[0], _MPL_GRID[1], _MPL_GRID[2])
        c.setLineWidth(0.30)
        c.line(x, y - row_h, x, y)

        if key == "_description_block":
            desc = _mpl_clean(item.get("description")).upper()
            exp = _mpl_exp_short(_mpl_clean(item.get("expiration_date")))

            ty = y - 0.14 * inch
            c.setFillColorRGB(0, 0, 0)

            ty = _draw_wrapped_left(
                c,
                desc,
                x + 5,
                ty,
                w - 10,
                "Helvetica-Bold",
                7.8,
                max_lines=4,
                leading=8.9,
            )

            meta_y = max(y - row_h + 0.09 * inch, ty - 0.02 * inch)
            c.setFont("Helvetica-Oblique", 7.2)

            if exp:
                c.drawString(x + 5, meta_y, f"EXP: {exp}")

        else:
            value = item.get(key)
            if key == "uom":
                value = _display_uom(value)

            c.setFillColorRGB(0, 0, 0)
            _draw_centered_wrapped(
                c,
                _mpl_clean(value),
                x,
                y - row_h / 2,
                w,
                "Helvetica-Bold",
                7.8,
                max_lines=1,
                leading=8.5,
            )

    last_x = _MPL_MARGIN + _MPL_INNER_W
    c.line(last_x, y - row_h, last_x, y)
    return y - row_h

def _render_mpl_pallet_group_row(c: canvas.Canvas, y: float, row_h: float, pallet_num: str, pallet_weight: str) -> float:
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, _MPL_LIGHT_GREY, _MPL_GRID, 0.40)

    cols = _mpl_col_widths()
    item_x, item_w = cols[0][2], cols[0][3]
    desc_x, desc_w = cols[1][2], cols[1][3]

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 8.4)
    c.drawString(item_x + 5, y - row_h / 2 - 3.0, f"Pallet: {_mpl_pallet_label(pallet_num)}")

    weight = _mpl_weight_label(pallet_weight)
    if weight:
        c.drawCentredString(desc_x + desc_w / 2, y - row_h / 2 - 3.0, weight)

    return y - row_h

def _mpl_build_units(items: List[Dict[str, Any]]) -> List[Tuple[str, Dict[str, Any], float]]:
    units: List[Tuple[str, Dict[str, Any], float]] = []
    for pallet, rows in _mpl_group_items(items):
        pallet_weight = ""
        for row in rows:
            if _mpl_clean(row.get("pallet_weight")):
                pallet_weight = _mpl_clean(row.get("pallet_weight"))
                break
        units.append(("group", {"pallet": pallet, "pallet_weight": pallet_weight}, 0.32 * inch))
        for row in rows:
            units.append(("item", row, _mpl_item_height(row)))
    return units


def _mpl_paginate_units(units: List[Tuple[str, Dict[str, Any], float]], available_h: float) -> List[List[Tuple[str, Dict[str, Any], float]]]:
    pages: List[List[Tuple[str, Dict[str, Any], float]]] = []
    current: List[Tuple[str, Dict[str, Any], float]] = []
    used = 0.0
    current_group: Optional[Tuple[str, Dict[str, Any], float]] = None
    for unit in units:
        kind, payload, height = unit
        if kind == "group":
            current_group = unit
        if current and used + height > available_h:
            pages.append(current)
            if kind == "item" and current_group is not None:
                current = [current_group]
                used = current_group[2]
            else:
                current = []
                used = 0.0
        current.append(unit)
        used += height
    if current:
        pages.append(current)
    return pages or [[]]


def render_kehe_master_packing_list_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Master Packing List pages from an edited draft."""
    apply_product_master_to_mpl_draft(draft, force=False)
    packing_lists = draft.get("packing_lists") or []
    if not packing_lists:
        raise ValueError("Draft contains no packing lists to render.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)

    total_pages_all = 0
    total_items_all = 0
    rows = []
    needs_review_count = 0

    for mpl in packing_lists:
        status = mpl.get("status", "Ready")
        if not _mpl_clean(mpl.get("ship_to")) or not _mpl_clean(mpl.get("customer_po_number")):
            status = "Needs Review"
            mpl["status"] = status
        if status == "Needs Review":
            needs_review_count += 1

        items = _mpl_prepare_items(mpl)
        total_items_all += len(items)
        units = _mpl_build_units(items)

        # A4 page with taller MPL rows. Keep pagination conservative so rows do not clip.
        pages_units = _mpl_paginate_units(units, available_h=6.85 * inch)
        total_mpl_pages = len(pages_units)

        if progress_callback:
            progress_callback(
                f"Rendering {mpl.get('id', 'MPL')} "
                f"({len(items)} item{'s' if len(items) != 1 else ''})..."
            )

        for page_idx, page_units in enumerate(pages_units, start=1):
            if progress_callback:
                progress_callback(
                    f"Rendering {mpl.get('id', 'MPL')} page {page_idx}/{total_mpl_pages}..."
                )

            mpl_page = dict(mpl)
            y = _render_mpl_header(c, mpl_page, page_idx, total_mpl_pages)
            y = _render_mpl_table_header(c, y)

            alt = 0
            for kind, payload, height in page_units:
                if y - height < _MPL_INNER_BOTTOM + 0.15 * inch:
                    break
                if kind == "group":
                    y = _render_mpl_pallet_group_row(
                        c,
                        y,
                        height,
                        payload.get("pallet", "1"),
                        payload.get("pallet_weight", ""),
                    )
                else:
                    bg = (1, 1, 1) if alt % 2 == 0 else _MPL_ROW_ALT
                    y = _render_mpl_item_row(c, payload, y, height, bg)
                    alt += 1

            # Outer border.
            c.setStrokeColorRGB(0.2, 0.2, 0.2)
            c.setLineWidth(0.8)
            c.rect(_MPL_MARGIN, _MPL_INNER_BOTTOM, _MPL_INNER_W, _MPL_PAGE_H - 2 * _MPL_MARGIN)

            if page_idx == 1 and mpl.get("warnings"):
                warning_text = "; ".join(
                    w for w in mpl["warnings"]
                    if "defaulted to 1" not in w.lower()
                    and "pallet count" not in w.lower()
                )
                if warning_text:
                    warn_y = _MPL_INNER_BOTTOM + 0.07 * inch
                    c.setFont("Helvetica-Oblique", 5.5)
                    c.setFillColorRGB(*_COLOR_LABEL)
                    for wline in wrap_text(warning_text, "Helvetica-Oblique", 5.5, _MPL_INNER_W - 0.10 * inch, max_lines=2):
                        c.drawString(_MPL_MARGIN + 0.05 * inch, warn_y, wline)
                        warn_y += 6.5
                    c.setFillColorRGB(0, 0, 0)

            c.showPage()
            total_pages_all += 1

        ship_to_lines = (_mpl_clean(mpl.get("ship_to"))).split("\n")
        ship_to_display = ship_to_lines[0] if ship_to_lines else "-"
        rows.append({
            "document": "Master Packing List",
            "status": status,
            "dc": mpl.get("dc", ""),
            "po": mpl.get("customer_po_number", ""),
            "items": len(items),
            "total_weight": mpl.get("total_weight", ""),
            "ship_to": ship_to_display,
            "note": "Generated from edited draft",
        })

    c.save()
    buf.seek(0)
    with open(out_pdf, "wb") as f:
        f.write(buf.read())

    return {
        "summary": {
            "success": True,
            "packing_lists": len(packing_lists),
            "pages": total_pages_all,
            "items": total_items_all,
            "needs_review": needs_review_count,
        },
        "rows": rows,
    }
