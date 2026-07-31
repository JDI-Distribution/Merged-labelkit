"""
KeHE GS1-128 label pipeline
---------------------------
Generates 4 x 6 in KeHE SSCC-18 / GS1-128 pallet/carton labels directly
from EDI 856 ASN XML files. No shipping-label PDF matching is performed.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
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
from reportlab.graphics.barcode import code128
from reportlab.lib.pagesizes import LETTER, A4, landscape
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


# ===========================================================================
# Global constants
# ===========================================================================
UPS_RE = re.compile(r"(1Z[0-9A-Z]{16})")
DEFAULT_KEHE_SHIP_FROM = "BAKELL LLC\n1967 ESSEX CT\nREDLANDS, CA 92373\nUSA"


# ===========================================================================
# Shared Directory.
# The editable source table is MPL_DIRECTORY_TABLE / data/mpl_directory.json.
# KeHE uses only rows marked Storefront = KeHE.
# ===========================================================================

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DIRECTORY_PATH = Path(
    os.getenv("MPL_DIRECTORY_FILE", str(PROJECT_ROOT / "data" / "mpl_directory.json"))
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
    """Load and validate Storefront=KeHE rows from the shared directory.

    Returns the Storefront=KeHE directory data with validation.
    Raises ValueError if data is invalid.
    """
    with DIRECTORY_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        rows = data.get("rows", [])
    elif isinstance(data, dict):
        rows = [{"dc": dc, **row} for dc, row in data.items() if isinstance(row, dict)]
    elif isinstance(data, list):
        rows = data
    else:
        raise ValueError("Shared directory JSON must be an object or rows list.")
    required = {"dc", "name", "delivery_address", "billing_address", "match_values"}
    filtered: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        dc = str(row.get("dc") or row.get("DC") or "").strip()
        if not dc:
            continue
        storefront = str(row.get("storefront") or "KeHE").strip() or "KeHE"
        if storefront.lower() != "kehe":
            continue
        missing = required - set(row)
        if missing:
            raise ValueError(
                f"KeHE DC directory row {dc} is missing: {', '.join(sorted(missing))}"
            )
        if not isinstance(row["match_values"], list):
            raise ValueError(
                f"KeHE DC directory row {dc} match_values must be a list."
            )
        row["storefront"] = storefront
        row["ship_from"] = str(row.get("ship_from") or DEFAULT_KEHE_SHIP_FROM).strip() or DEFAULT_KEHE_SHIP_FROM
        filtered[dc] = row
    return filtered


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
    po: str = ""


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


def _location_suffix_from_code(value: str) -> str:
    """Return the KeHE DC suffix from a GLN/location code when applicable."""
    digits = re.sub(r"\D", "", value or "")
    if len(digits) >= 12:
        return digits[-2:]
    return digits


def _parse_store_from_n1(n1_seg: Optional[ET.Element]) -> str:
    """Return a display location key from an N1 segment.

    KeHE ST/BY N104 is often a 13-digit GLN/location code; for labels the
    warehouse/DC display should use the last two digits, not the full GLN.
    """
    if n1_seg is None:
        return ""
    qual = (_get_elem(n1_seg, "01") or "").strip().upper()
    n102 = _get_elem(n1_seg, "02")
    n104 = _get_elem(n1_seg, "04")
    if qual in {"ST", "BY"}:
        suffix = _location_suffix_from_code(n104)
        if suffix:
            return suffix.zfill(2) if len(suffix) <= 2 else suffix
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

def _td1_quantity_summary(container: ET.Element) -> Dict[str, str]:
    """Capture separate shipment-level TD1 counts for cartons and pallets."""
    out = {"carton_count": "", "pallet_count": "", "first_code": "", "first_qty": ""}
    for td1 in _segment_refs(container, "TD1", deep=False):
        code = (_get_elem(td1, "01") or "").strip().upper()
        qty = (_get_elem(td1, "02") or "").strip()
        ptype = _package_type_from_td1_code(code)
        if code and not out["first_code"]:
            out["first_code"] = code
        if qty and not out["first_qty"]:
            out["first_qty"] = qty
        if qty and ptype == "CTN" and not out["carton_count"]:
            out["carton_count"] = qty
        elif qty and ptype == "PLT" and not out["pallet_count"]:
            out["pallet_count"] = qty
    return out


def _carrier_from_td5(td5: ET.Element) -> Tuple[str, str, str]:
    """Return (carrier display, SCAC, TD505 routing value) from TD5.

    TD502 is only the qualifier and must not be printed as a carrier. TD505 is
    routing/carrier name; TD503 is SCAC when TD502=2.
    """
    qualifier = (_get_elem(td5, "02") or "").strip()
    td503 = (_get_elem(td5, "03") or "").strip()
    td505 = (_get_elem(td5, "05") or "").strip()
    scac = td503 if qualifier == "2" and td503 else ""
    td505_compact = re.sub(r"\s+", "", td505).upper()
    td505_looks_like_reference = bool(td505_compact.isdigit() or UPS_RE.fullmatch(td505_compact))
    # Some SPS exports place the BOL/route number in TD505. In that case, print
    # the SCAC/TD503 as carrier instead of showing the numeric reference as carrier.
    carrier = (td505 if td505 and not td505_looks_like_reference else "") or td503
    return carrier, scac, td505


def _extract_man_identifiers(container: ET.Element) -> Tuple[str, str]:
    """Return (GS1 SSCC, carrier tracking) from MAN segments.

    KeHE requires GS1-128 SSCC from MAN01=GM / MAN02. Carrier tracking is CP
    and can appear either as MAN01/02 or MAN04/05 when GM is also present.
    """
    sscc = ""
    tracking = ""
    for man in _segment_refs(container, "MAN", deep=False):
        q1 = (_get_elem(man, "01") or "").strip().upper()
        v1 = (_get_elem(man, "02") or "").strip()
        q2 = (_get_elem(man, "04") or "").strip().upper()
        v2 = (_get_elem(man, "05") or "").strip()
        if q1 == "GM" and v1 and not sscc:
            sscc = v1
        elif q1 == "CP" and v1 and not tracking:
            tracking = v1
        if q2 == "GM" and v2 and not sscc:
            sscc = v2
        elif q2 == "CP" and v2 and not tracking:
            tracking = v2
    return sscc, tracking


def _plant_from_n1loops(container: ET.Element) -> str:
    """Return manufacturer / plant identifier from pack- or item-level N1 MF loop."""
    for n1loop in container.findall(".//N1-LOOP"):
        n1 = n1loop.find("./SegmentRef[@ID='N1']")
        if n1 is None:
            continue
        if (_get_elem(n1, "01") or "").strip().upper() == "MF":
            plant = (_get_elem(n1, "04") or "").strip() or (_get_elem(n1, "02") or "").strip()
            if plant:
                return plant
    return ""


def _append_unique_csv(existing: str, value: str) -> str:
    values: List[str] = []
    for raw in re.split(r"[,;\n]+", existing or "") + re.split(r"[,;\n]+", value or ""):
        raw = raw.strip()
        if raw and raw not in values:
            values.append(raw)
    return ", ".join(values)


def _item_signature(item: Item) -> Tuple[Any, ...]:
    return (
        item.po, item.vendor_item, item.retailer_item, item.upc, item.case_upc,
        item.description, item.qty, item.uom, item.lot, item.expiration_date,
        item.manufacture_date, item.plant,
    )


def _merge_duplicate_physical_packs(packs: List[Pack]) -> List[Pack]:
    """Merge repeated SSCC rows into one physical label/pallet while preserving POs/items."""
    merged: List[Pack] = []
    by_key: Dict[str, Pack] = {}
    item_sigs_by_key: Dict[str, set[Tuple[Any, ...]]] = {}
    for pack in packs:
        key = normalize_sscc(pack.sscc) or (pack.sscc or "").strip()
        if not key:
            key = f"__missing__{len(merged)}"
        if key not in by_key:
            by_key[key] = pack
            merged.append(pack)
            item_sigs_by_key[key] = {_item_signature(item) for item in pack.items}
            continue
        base = by_key[key]
        base.po = _append_unique_csv(base.po, pack.po)
        base.store = base.store or pack.store
        base.tracking = base.tracking or pack.tracking
        base.ship_date = base.ship_date or pack.ship_date
        base.carrier_name = base.carrier_name or pack.carrier_name
        base.scac = base.scac or pack.scac
        base.bol = base.bol or pack.bol
        base.pro = base.pro or pack.pro
        base.lot = base.lot or pack.lot
        base.expiration_date = base.expiration_date or pack.expiration_date
        base.plant = base.plant or pack.plant
        if (base.package_type or "CTN").upper().startswith("CTN") and (pack.package_type or "").upper().startswith("PLT"):
            base.package_type = pack.package_type
        sigs = item_sigs_by_key.setdefault(key, set())
        for item in pack.items:
            sig = _item_signature(item)
            if sig not in sigs:
                base.items.append(item)
                sigs.add(sig)
    return merged


def _extract_bsn_hl_groups(root: ET.Element) -> List[Tuple[ET.Element, List[ET.Element]]]:
    """Return one (BSN, HL loops) group per ASN transaction inside an SPS XML file.

    This preserves files containing multiple ST/SE transactions instead of letting
    document-level fields from one ASN bleed into another ASN.
    """
    groups: List[Tuple[ET.Element, List[ET.Element]]] = []
    seen_bsn_ids: set[int] = set()

    for elem in root.iter():
        current_bsn: Optional[ET.Element] = None
        current_hls: List[ET.Element] = []
        saw_relevant_child = False

        for child in list(elem):
            tag = child.tag
            seg_id = child.attrib.get("ID", "")
            if tag == "SegmentRef" and seg_id == "BSN":
                saw_relevant_child = True
                if current_bsn is not None and id(current_bsn) not in seen_bsn_ids:
                    groups.append((current_bsn, current_hls))
                    seen_bsn_ids.add(id(current_bsn))
                current_bsn = child
                current_hls = []
            elif tag == "HL-LOOP" and current_bsn is not None:
                saw_relevant_child = True
                current_hls.append(child)

        if saw_relevant_child and current_bsn is not None and id(current_bsn) not in seen_bsn_ids:
            groups.append((current_bsn, current_hls))
            seen_bsn_ids.add(id(current_bsn))

    return groups


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
    shipment_ship_to_store = ""
    shipment_carrier_name = ""
    shipment_scac = ""
    shipment_bol = ""
    shipment_pro = ""
    shipment_package_type = "CTN"
    shipment_td1_types: set[str] = set()
    has_tare_hl = any(
        ((_get_elem(hl.find("./SegmentRef[@ID='HL']"), "03") or "").strip().upper() == "T")
        for hl in hl_loops
    )

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

        if level == "S":
            for td1 in _segment_refs(hl, "TD1", deep=False):
                detected_package_type = _package_type_from_td1_code(_get_elem(td1, "01"))
                if detected_package_type:
                    shipment_td1_types.add(detected_package_type)
            if shipment_td1_types == {"PLT"}:
                shipment_package_type = "PLT"
            elif "CTN" in shipment_td1_types:
                shipment_package_type = "CTN"

            for td5 in _segment_refs(hl, "TD5", deep=False):
                carrier, scac, _td5_routing = _carrier_from_td5(td5)
                shipment_scac = shipment_scac or scac
                shipment_carrier_name = shipment_carrier_name or carrier

            for td3 in _segment_refs(hl, "TD3", deep=False):
                v = (_get_elem(td3, "03") or "").replace(" ", "")
                m = UPS_RE.search(v.upper())
                if m:
                    shipment_tracking = m.group(1)
                    break

            refs = _scan_ref_values(hl, deep=False)
            shipment_bol = _first_ref(refs, ("BM", "MB", "BL"))
            shipment_pro = _first_ref(refs, ("CN", "2I", "SI", "PK", "TR"))

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
                        shipment_ship_to_store = shipment_ship_to_store or store

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
                    store = _parse_store_from_n1(n1) or store
                if qual == "ST":
                    store = _parse_store_from_n1(n1) or store
                    _q, ship_to = _parse_address(n1loop)

            if not ship_to.name and store:
                ship_to = ship_to_by_store.get(store, Address())
            # Fallback: use the shipment-level ST address when no order-level
            # address was found (e.g., XMLs where N1/N4 only appear at HL=S).
            if not ship_to.zip and shipment_ship_to.zip:
                ship_to = shipment_ship_to
            if not store and shipment_ship_to_store:
                store = shipment_ship_to_store

            order = Order(po=po, store=store, ship_to=ship_to, ship_from=ship_from)
            orders.append(order)
            if hl_id:
                order_by_hl_id[hl_id] = order

        elif level in ("P", "T"):
            order = order_by_hl_id.get(parent_hl_id)
            if order is None:
                raise ValueError(
                    f"Unable to map pack/tare HL {hl_id or '(unknown)'} to an order HL via parent id {parent_hl_id or '(missing)'}."
                )

            sscc, man_tracking = _extract_man_identifiers(hl)
            if not sscc:
                raise ValueError(
                    f"Missing KeHE GS1 SSCC for PO {order.po}: expected MAN01=GM and MAN02 with the 20-digit GS1-128 value."
                )

            pack_plant = _plant_from_n1loops(hl)
            pack_refs = _scan_ref_values(hl, deep=False)
            pack_tracking = man_tracking or shipment_tracking
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
            package_type = "PLT" if level == "T" else shipment_package_type
            if level == "P" and not has_tare_hl and shipment_td1_types == {"PLT"}:
                # Backward compatibility with older SPS XML exports where P loops
                # were used to represent pallets and shipment TD101 was PLT.
                package_type = "PLT"
            if level == "P" and has_tare_hl:
                package_type = "CTN"

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
                pro=_first_ref(pack_refs, ("CN", "2I", "SI", "PK", "TR")) or shipment_pro,
                package_type=package_type or "CTN",
                lot=_first_ref(pack_refs, ("LT", "LO", "BT")),
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
                    pending_item.po = pending_item.po or order.po
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
            item_plant = _plant_from_n1loops(hl)
            owner_order = pack_order_by_hl_id.get(parent_hl_id)
            raw_item_lot = _first_ref(refs, ("LT", "LO", "BT"))
            inherited_pack_exp = ""
            if parent_pack is not None and (not raw_item_lot or raw_item_lot == parent_pack.lot):
                inherited_pack_exp = parent_pack.expiration_date
            item = Item(
                vendor_item=pairs.get("VN", "") or pairs.get("VC", "") or pairs.get("VP", "") or pairs.get("SK", ""),
                retailer_item=pairs.get("CB", "") or pairs.get("IN", "") or pairs.get("BP", "") or pairs.get("PI", ""),
                upc=pairs.get("UP", "") or pairs.get("UA", "") or pairs.get("EN", "") or pairs.get("UK", ""),
                case_upc=pairs.get("UK", ""),
                description=_get_elem(pid, "05") if pid is not None else "",
                qty=qty,
                uom=_get_elem(sn1, "03") if sn1 is not None else "",
                lot=raw_item_lot or (parent_pack.lot if parent_pack else ""),
                expiration_date=dates.get("036") or dates.get("361") or inherited_pack_exp,
                manufacture_date=dates.get("405") or dates.get("094") or dates.get("371") or dates.get("118") or dates.get("011") or "",
                plant=item_plant or _first_ref(refs, ("PL", "MF", "SU")) or (parent_pack.plant if parent_pack else ""),
                po=(owner_order.po if owner_order else ""),
            )
            if parent_pack is None:
                if parent_hl_id:
                    pending_items_by_pack_hl.setdefault(parent_hl_id, []).append(item)
                continue
            parent_pack.items.append(item)
            if owner_order is not None:
                owner_order.items.append(item)

    deduped = _merge_duplicate_physical_packs(packs_flat)

    total = len(deduped) or 1
    for idx, pack in enumerate(deduped, start=1):
        pack.carton_index = idx
        pack.total_cartons = total

    return orders, deduped


def parse_asn(xml_path: str) -> Tuple[List[Order], List[Pack]]:
    root = ET.parse(xml_path).getroot()

    all_orders: List[Order] = []
    all_packs: List[Pack] = []

    for bsn_seg, hl_loops in _extract_bsn_hl_groups(root):
        orders, packs = _parse_shipment_group(bsn_seg, hl_loops)
        all_orders.extend(orders)
        # Keep carton/pallet numbering as assigned per ASN by _parse_shipment_group.
        # Do not renumber across multiple ASNs in one XML file.
        all_packs.extend(packs)

    return all_orders, all_packs


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

    upcs = [it.upc or it.retailer_item or it.vendor_item for it in pack.items]
    descs = [it.description for it in pack.items]
    product_keys = {
        ((it.upc or it.retailer_item or it.vendor_item or "").strip(), (it.description or "").strip())
        for it in pack.items
        if (it.upc or it.retailer_item or it.vendor_item or it.description)
    }
    mixed = len(product_keys) > 1
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
    rendered_lines = 0
    for line in lines:
        if rendered_lines >= max_lines:
            break
        for wrapped in wrap_text(
            line,
            "Helvetica",
            size,
            width,
            max_lines=max_lines - rendered_lines,
        ):
            c.drawString(x, y, wrapped)
            y -= leading
            rendered_lines += 1
    return y


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
    location_code = (pack.store or "").strip()
    if location_code and location_code.isdigit() and len(location_code) <= 2:
        dc_prefix = f"DC {int(location_code):02d}"
        if not ship_to_name.upper().startswith(dc_prefix):
            ship_to_name = f"{dc_prefix} - {ship_to_name}".strip(" -")
    elif location_code and location_code not in ship_to_name:
        ship_to_name = f"{ship_to_name} #{location_code}".strip()

    y = y_top - 0.15 * inch
    _draw_label(c, right_x, y, "Ship To:", 12.0)
    y -= 0.17 * inch
    _draw_value_lines(
        c,
        [ship_to_name, st.line1, st.line2, f"{st.city}, {st.state} {st.zip}".strip(", "), st.country],
        right_x,
        y,
        right_w,
        size=12.0,
        leading=11.7,
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
        ("Manufacturing Date:", _format_label_date_mmddyyyy(summary["manufacture"])),
        ("Manufacturing Plant #:", summary["plant"]),
    ]

    for label, value in trace_rows:
        _draw_label(c, left_x, y, label, 10.0)
        if value:
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
    seen_file_hashes: set[str] = set()
    duplicate_files: List[str] = []
    for xp in xml_paths:
        fhash = _file_hash(xp) if Path(xp).exists() else xp
        if fhash in seen_file_hashes:
            duplicate_files.append(Path(xp).name)
            continue
        seen_file_hashes.add(fhash)
        _status_log(f"Parsing XML: {xp}")
        _orders, packs = parse_asn(xp)
        all_packs.extend(packs)

    if not all_packs:
        raise ValueError("No packs with SSCC values were found in the uploaded XML.")

    total = len(all_packs)

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


def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Generate KeHE GS1-128 labels from ASN XML")
    parser.add_argument("--xml", nargs="+", required=True, help="ASN XML file(s)")
    parser.add_argument("--out", required=True, help="Output PDF path")
    args = parser.parse_args(argv)
    run_pipeline(xml_paths=args.xml, out_pdf=args.out)


if __name__ == "__main__":
    main()


# ===========================================================================
# KeHE Documents Pipeline: Pallet Placards and Master Packing Lists
# ===========================================================================

def _get_elem(seg: Optional[ET.Element], pos: str) -> str:
    if seg is None:
        return ""
    el = seg.find(f"./Element[@Pos='{pos}']")
    return (el.attrib.get("Value") if el is not None else "") or ""


def _format_date(value: str) -> str:
    """Convert various EDI date formats to MM/DD/YYYY for PDF consistency."""
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
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}/{digits[6:8]}/{digits[0:4]}"
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}/{digits[2:4]}/{digits[4:8]}"
        return value
    if len(digits) == 6:
        return f"{digits[2:4]}/{digits[4:6]}/20{digits[0:2]}"
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

def _new_kehe_header(xml_path: str, *, group_index: int = 1, group_count: int = 1) -> Dict[str, Any]:
    source = Path(xml_path).name
    if group_count > 1:
        source = f"{source} :: ASN {group_index}"
    return {
        "source_file": source,
        "file_hash": _file_hash(xml_path),
        "asn_group_index": str(group_index),
        "asn_group_count": str(group_count),
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
        "xml_pack_count": "",
        "xml_carton_pack_count": "",
        "xml_pallet_pack_count": "",
        "has_tare_pallets": "",
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


def _parse_kehe_document_header_from_group(
    xml_path: str,
    bsn_seg: ET.Element,
    hl_loops: List[ET.Element],
    *,
    group_index: int = 1,
    group_count: int = 1,
) -> Dict[str, Any]:
    """Parse document/header fields for one ASN transaction only."""
    header = _new_kehe_header(xml_path, group_index=group_index, group_count=group_count)
    header["bsn"] = _get_elem(bsn_seg, "02")

    po_numbers: List[str] = []
    pack_hl_count = 0
    carton_hl_count = 0
    pallet_hl_count = 0
    shipment_n1_quals: set[str] = set()
    saw_gm_sscc = False
    saw_item = False

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = (_get_elem(hl_seg, "03") or "").strip().upper()

        if level in ("P", "T"):
            pack_hl_count += 1
            if level == "T":
                pallet_hl_count += 1
            else:
                carton_hl_count += 1
            sscc, _tracking = _extract_man_identifiers(hl)
            if sscc:
                saw_gm_sscc = True
            else:
                header["warnings"].append("Pack/tare HL is missing MAN01=GM / MAN02 GS1 SSCC.")

        if level == "S":
            td1_summary = _td1_quantity_summary(hl)
            header["td1_package_code"] = header["td1_package_code"] or td1_summary.get("first_code", "")
            header["td1_quantity"] = header["td1_quantity"] or td1_summary.get("first_qty", "")
            if td1_summary.get("carton_count"):
                header["td1_quantity_type"] = header["td1_quantity_type"] or "carton"
                header["xml_carton_count"] = header["xml_carton_count"] or td1_summary["carton_count"]
                header["carton_count"] = header["carton_count"] or td1_summary["carton_count"]
            if td1_summary.get("pallet_count"):
                header["td1_quantity_type"] = "pallet" if not header["td1_quantity_type"] else header["td1_quantity_type"]
                header["xml_total_pallets"] = header["xml_total_pallets"] or td1_summary["pallet_count"]
                header["total_pallets"] = header["total_pallets"] or td1_summary["pallet_count"]

            for td1 in _segment_refs(hl, "TD1"):
                weight = _get_elem(td1, "07")
                weight_unit = _get_elem(td1, "08")
                cube = _get_elem(td1, "09")
                cube_unit = _get_elem(td1, "10")
                if weight and not header["total_weight"]:
                    header["total_weight"] = f"{weight} {weight_unit}".strip() if weight_unit else weight
                if cube and not header["cube"]:
                    header["cube"] = f"{cube} {cube_unit}".strip() if cube_unit else cube

            for td5 in _segment_refs(hl, "TD5"):
                carrier, _scac, _td5_routing = _carrier_from_td5(td5)
                if not header["carrier"]:
                    header["carrier"] = carrier

            refs = _scan_ref_values(hl)
            if not any(q in refs for q in ("BM", "CN", "2I")):
                header["warnings"].append(
                    "Shipment REF is missing KeHE-required BM, CN, or 2I. Verify BOL/PRO/tracking before printing."
                )
            if "2I" in refs and ("BM" in refs or "CN" in refs):
                header["warnings"].append(
                    "Shipment has parcel tracking 2I together with BM/CN. KeHE says not to send both for parcel/common-carrier refs."
                )
            header["bol_number"] = header["bol_number"] or _first_ref(refs, ("BM",)) or _first_ref(refs, ("MB", "BL"))
            header["pro_number"] = header["pro_number"] or _first_ref(refs, ("CN", "2I")) or _first_ref(refs, ("SI", "PK", "TR"))

            dates = _scan_dates(hl)
            header["ship_date"] = header["ship_date"] or dates.get("011") or dates.get("068") or ""
            header["expected_delivery_date"] = header["expected_delivery_date"] or dates.get("017") or ""

            for n1loop in hl.findall("./N1-LOOP"):
                qual, addr = _parse_n1loop_addr(n1loop)
                if qual:
                    shipment_n1_quals.add(qual)
                if qual == "ST" and not header["xml_ship_to"]:
                    header["ship_to_gln"] = addr.get("gln", "")
                    header["xml_ship_to"] = addr
                elif qual == "SF" and not header["xml_ship_from"]:
                    header["xml_ship_from"] = addr

        elif level == "O":
            prf = hl.find("./SegmentRef[@ID='PRF']")
            if prf is not None:
                po_value = (_get_elem(prf, "01") or "").strip()
                if po_value and po_value not in po_numbers:
                    po_numbers.append(po_value)
                if not header["po_date"]:
                    raw = _get_elem(prf, "04")
                    if raw:
                        header["po_date"] = _format_date(raw)

            refs = _scan_ref_values(hl)
            header["order_no"] = header["order_no"] or _first_ref(refs, ("VR",))
            header["vendor_number"] = header["vendor_number"] or _first_ref(refs, ("IA",))

        elif level == "I":
            saw_item = True
            lin = hl.find("./SegmentRef[@ID='LIN']")
            sn1 = hl.find("./SegmentRef[@ID='SN1']")
            pid = hl.find("./SegmentRef[@ID='PID']")
            pairs = _parse_lin_pairs(lin)
            refs = _scan_ref_values(hl)
            dates = _scan_dates(hl)
            if not (pairs.get("UP") or pairs.get("UA") or pairs.get("EN") or pairs.get("UK")):
                header["warnings"].append("Item HL is missing LIN UPC/GTIN value.")
            if not (_get_elem(sn1, "02") if sn1 is not None else ""):
                header["warnings"].append("Item HL is missing SN102 shipped quantity.")
            if not (_get_elem(pid, "05") if pid is not None else ""):
                header["warnings"].append("Item HL is missing PID05 product description.")
            if _first_ref(refs, ("LT", "LO", "BT")) and not (dates.get("036") or dates.get("361")):
                header["warnings"].append(
                    "Item-level lot is present without item-level DTM036 expiration. Do not rely on pack expiration when lots differ."
                )

    header["xml_pack_count"] = str(pack_hl_count) if pack_hl_count else ""
    header["xml_carton_pack_count"] = str(carton_hl_count) if carton_hl_count else ""
    header["xml_pallet_pack_count"] = str(pallet_hl_count) if pallet_hl_count else ""
    header["has_tare_pallets"] = "1" if pallet_hl_count else ""
    if po_numbers:
        header["customer_po_number"] = ", ".join(po_numbers)

    if not header["carrier"]:
        header["warnings"].append("Shipment TD5 carrier/routing is missing. KeHE requires TD505 or TD503/SCAC.")
    if not header["ship_date"]:
        header["warnings"].append("Shipment DTM 011 ship date is missing.")
    if "SF" not in shipment_n1_quals:
        header["warnings"].append("Shipment-level Ship From N1 SF loop is missing.")
    if "ST" not in shipment_n1_quals:
        header["warnings"].append("Shipment-level Ship To N1 ST loop is missing.")
    if "VN" not in shipment_n1_quals:
        header["warnings"].append("Shipment-level Vendor N1 VN loop is missing.")
    if not po_numbers:
        header["warnings"].append("Order-level PRF01 customer PO number is missing.")
    if not header["vendor_number"]:
        header["warnings"].append("Order-level REF IA KeHE supplier/vendor number is missing.")
    if pack_hl_count and not saw_gm_sscc:
        header["warnings"].append("No valid MAN01=GM GS1 SSCC found in pack/tare HL loops.")
    if not saw_item:
        header["warnings"].append("No item HL rows were found.")

    # Do not substitute BSN as BOL/PRO. Missing refs should remain blank and visible.
    deduped_warnings: List[str] = []
    for warning in header.get("warnings", []):
        if warning and warning not in deduped_warnings:
            deduped_warnings.append(warning)
    header["warnings"] = deduped_warnings
    return header


def parse_kehe_document_headers(xml_path: str) -> List[Dict[str, Any]]:
    root = ET.parse(xml_path).getroot()
    groups = _extract_bsn_hl_groups(root)
    count = len(groups) or 1
    return [
        _parse_kehe_document_header_from_group(xml_path, bsn, hls, group_index=i, group_count=count)
        for i, (bsn, hls) in enumerate(groups, start=1)
    ]


def parse_kehe_document_header(xml_path: str) -> Dict[str, Any]:
    """Backward-compatible helper: return the first ASN header in a file."""
    headers = parse_kehe_document_headers(xml_path)
    if headers:
        return headers[0]
    return _new_kehe_header(xml_path)


# ===========================================================================
# Shipment normalization
# ===========================================================================

def build_document_shipments(xml_paths: List[str]) -> Dict[str, Any]:
    """Parse and deduplicate XML files into normalized shipment dicts.

    Deduplication is by file SHA-256 hash first. Each ASN transaction inside a
    file becomes its own shipment so MPL/pallet-label headers cannot mix data.
    """
    shipments = []
    file_hashes: set = set()
    duplicate_files: List[str] = []

    for xml_path in xml_paths:
        fhash = _file_hash(xml_path)
        source_file = Path(xml_path).name
        if fhash in file_hashes:
            duplicate_files.append(source_file)
            continue
        file_hashes.add(fhash)

        root = ET.parse(xml_path).getroot()
        groups = _extract_bsn_hl_groups(root)
        group_count = len(groups) or 1

        for group_index, (bsn_seg, hl_loops) in enumerate(groups, start=1):
            header = _parse_kehe_document_header_from_group(
                xml_path,
                bsn_seg,
                hl_loops,
                group_index=group_index,
                group_count=group_count,
            )
            try:
                orders, packs = _parse_shipment_group(bsn_seg, hl_loops)
            except Exception as exc:
                raise ValueError(f"Failed to parse {header['source_file']}: {exc}") from exc

            # Duplicate SSCC rows inside the same ASN are merged by _parse_shipment_group.
            # Do not suppress same-SSCC records across different uploaded files unless the
            # file hash itself is identical; corrected/resubmitted ASNs must remain visible.
            unique_packs = _merge_duplicate_physical_packs(packs)

            pallet_pack_count = sum(1 for pack in unique_packs if (pack.package_type or "").upper().startswith("PLT"))
            carton_pack_count = sum(1 for pack in unique_packs if not (pack.package_type or "").upper().startswith("PLT"))
            header["pack_count"] = str(len(unique_packs)) if unique_packs else ""
            if pallet_pack_count:
                header["has_tare_pallets"] = header.get("has_tare_pallets") or "1"
                header["xml_pallet_pack_count"] = header.get("xml_pallet_pack_count") or str(pallet_pack_count)
            if carton_pack_count:
                header["xml_carton_pack_count"] = header.get("xml_carton_pack_count") or str(carton_pack_count)
            if not header.get("carton_count"):
                header["carton_count"] = str(carton_pack_count or len(unique_packs)) if unique_packs else ""
            if not header.get("total_pallets"):
                header["total_pallets"] = header.get("xml_total_pallets") or (str(pallet_pack_count) if pallet_pack_count else "1")

            dc_info = find_kehe_dc(
                st_gln=header["ship_to_gln"],
                line1=header["xml_ship_to"].get("line1", ""),
                city=header["xml_ship_to"].get("city", ""),
                state=header["xml_ship_to"].get("state", ""),
                zip_code=header["xml_ship_to"].get("zip", ""),
            )
            needs_review = dc_info is None or bool(header.get("warnings"))

            if dc_info is None:
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


def _dc_ship_from_str(dc_info: Optional[Dict[str, Any]], header: Dict[str, Any], packs: list) -> str:
    """Use XML ship-from for XML-generated documents; fall back only if XML is blank.

    DC Directory ship_from is intentionally used only by the frontend manual
    DC Directory Preview flow, not by XML-generated Pallet Label / MPL drafts.
    """
    return _ship_from_str(header, packs) or DEFAULT_KEHE_SHIP_FROM


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

    Correct KeHE pallet XML uses HL03=T for tare/pallet SSCCs. Some legacy SPS
    XML exports used HL03=P with shipment TD101=PLT, so both are supported. The
    PO printed on a placard is aggregated from the physical SSCC's parent order(s),
    not from a first-PO-only shipment header.

    If XML does not explicitly identify pallets, preserve the legacy behavior: one
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
        ship_from = _dc_ship_from_str(dc_info, header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)
        source_file = header.get("source_file", "")

        total_pallets = str(_safe_positive_int(
            header.get("total_pallets") or header.get("xml_total_pallets") or "1",
            1,
        ))
        explicit_pallet_xml = bool(header.get("xml_total_pallets") or header.get("has_tare_pallets"))

        base_warnings: List[str] = list(header.get("warnings", []))

        if explicit_pallet_xml:
            if len(packs) != _safe_positive_int(total_pallets, 1):
                base_warnings.append(
                    f"XML says Total Pallets={total_pallets}, but {len(packs)} physical SSCC pallet records were found. Verify pallet labels."
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
    default_pallet: str = "1",
) -> List[Dict[str, Any]]:
    """Aggregate XML item rows into editable MPL lines.

    Important KeHE rule:
      - If HL03=T or TD101 says PLT/Pallet, each physical SSCC stays with its parent pallet/pack loop.
        Items must stay with their parent pack/tare loop.
      - If TD101 says CTN/Carton or the XML is unclear, leave item rows
        Unassigned so the frontend/user can Auto Palletize or manually assign.

    The aggregation key includes pallet number whenever `preserve_pack_pallets`
    is true. That prevents the same UPC from being merged across different
    pallets and avoids the previous wrong round-robin pallet assignment.
    """
    aggregated: Dict[Tuple[str, str, str, str, str, str, str], Dict[str, Any]] = {}
    allowed_pallets = set(_pallet_ids_for_total(total_pallets))

    for fallback_idx, pack in enumerate(packs, start=1):
        pallet_number = str(pack.carton_index or fallback_idx) if preserve_pack_pallets else str(default_pallet or "")
        if preserve_pack_pallets and allowed_pallets and pallet_number not in allowed_pallets:
            # Keep real XML order, but do not create impossible pallet numbers when
            # TD102 and physical SSCC count disagree. User can still edit the draft.
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
                    "length_in": "",
                    "width_in": "",
                    "height_in": "",
                    "dimensions_in": "",
                    "unit_weight_lbs": "",
                    "calculated_weight_lbs": "",
                    "qty_on_pallet": 0,
                    "total_ordered": 0,
                    "total_shipped": 0,
                    "pallet_weight": "",
                    "notes": "",
                    "source_sscc": normalize_sscc(pack.sscc),
                    "customer_po_number": item.po or pack.po,
                }
            else:
                aggregated[key]["customer_po_number"] = _append_unique_csv(
                    aggregated[key].get("customer_po_number", ""),
                    item.po or pack.po,
                )

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

_PACKAGING_LEVELS = {
    "CASE": "Case",
    "INNER PACK": "Inner Pack",
    "EACH": "Each",
    "SHIPPER CONTENTS": "Shipper Contents",
    "OTHER": "Other",
}


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
    raw_no_space = raw.replace(" ", "")
    if raw in ("INNER", "INNER PACKS", "IP") or raw_no_space in {"INNERPACK", "INNERPACKS"}:
        raw = "INNER PACK"
    if raw in ("CASE", "CASES", "MASTER PACK", "MASTER PACKS", "MASTER", "MP", "CASE PACK", "CASE PACKS"):
        raw = "CASE"
    if raw in ("SHIPPER", "SHIPPER CONTENT", "SHIPPER CONTENTS") or raw_no_space in {"SHIPPERCONTENT", "SHIPPERCONTENTS"}:
        raw = "SHIPPER CONTENTS"
    return _PACKAGING_LEVELS.get(raw, "Other")


def _boolish(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    raw = str(value).strip().lower()
    if not raw:
        return default
    if raw in {"1", "true", "yes", "y", "on", "checked", "✅", "x"}:
        return True
    if raw in {"0", "false", "no", "n", "off", "unchecked", "barcode on product"}:
        return False
    if "barcode" in raw and "product" in raw:
        return False
    return default


def _product_in_packing_list(row: Dict[str, Any], packaging_level: str) -> bool:
    return _boolish(row.get("is_active", row.get("IS_ACTIVE", True)), True) and _normalize_packaging_level(packaging_level) == "Case"


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


def _format_number(value: Optional[float]) -> str:
    if value is None:
        return ""
    if abs(value - round(value)) < 0.000001:
        return str(int(round(value)))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def _product_dimensions_display(product: Dict[str, Any]) -> str:
    values = [
        _format_number(_parse_float(product.get("length_in"))),
        _format_number(_parse_float(product.get("width_in"))),
        _format_number(_parse_float(product.get("height_in"))),
    ]
    return " x ".join(values) if all(values) else ""


def _legacy_product_master_adapter(row: Dict[str, Any]) -> Dict[str, Any]:
    """Convert one historical Product Master snapshot to the current fields."""
    adapted = dict(row)
    dimensions = str(
        row.get("dimensions_in")
        or row.get("DIMENSIONS_IN")
        or row.get("lwh_in")
        or row.get("L X W X H (in)")
        or row.get("dimensions")
        or ""
    ).strip()
    if dimensions and not all(adapted.get(key) not in (None, "") for key in ("length_in", "width_in", "height_in")):
        values = re.findall(r"-?\d+(?:\.\d+)?", dimensions.replace(",", ""))
        if len(values) >= 3:
            adapted.setdefault("length_in", values[0])
            adapted.setdefault("width_in", values[1])
            adapted.setdefault("height_in", values[2])
    if adapted.get("gross_weight_lbs") in (None, ""):
        adapted["gross_weight_lbs"] = row.get("weight_lbs") or row.get("WEIGHT_LBS") or row.get("WEIGHT(lbs)") or row.get("weight") or ""
    if adapted.get("default_copies") in (None, ""):
        adapted["default_copies"] = row.get("labels_per_unit") or row.get("LABELS_PER_UNIT") or row.get("Labels / Unit") or row.get("labels_to_print_per_unit") or row.get("label_copies_per_unit") or ""
    return adapted


def _normalize_product_master_rows(rows: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if not rows:
        return out
    for idx, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            continue
        row = _legacy_product_master_adapter(row)
        storefront = str(row.get("storefront") or row.get("STOREFRONT") or row.get("Storefront") or "KeHE").strip() or "KeHE"
        gtin = str(row.get("gtin") or row.get("GTIN") or row.get("case_upc") or row.get("upc") or "").strip()
        desc = str(row.get("description") or row.get("DESCRIPTION") or "").strip()
        packaging_level = _normalize_packaging_level(row.get("packaging_level") or row.get("packging_level") or row.get("PACKGING LEVEL") or row.get("PACKAGING LEVEL"))
        length_in = _format_number(_parse_float(row.get("length_in") or row.get("LENGTH_IN")))
        width_in = _format_number(_parse_float(row.get("width_in") or row.get("WIDTH_IN") or row.get("breadth_in") or row.get("BREADTH_IN")))
        height_in = _format_number(_parse_float(row.get("height_in") or row.get("HEIGHT_IN")))
        gross_weight_lbs = _format_number(_parse_float(row.get("gross_weight_lbs") or row.get("GROSS_WEIGHT_LBS")))
        sku = str(row.get("sku") or row.get("SKU") or "").strip()
        in_packing_list = _product_in_packing_list(row, packaging_level)
        default_case_qty = "6" if packaging_level == "Inner Pack" else ("1" if packaging_level == "Case" else "")
        case_qty = str(
            row.get("case_qty")
            or row.get("Case Qty")
            or row.get("case_quantity")
            or row.get("units_per_case")
            or default_case_qty
        ).strip()
        default_copies = str(
            row.get("default_copies")
            or row.get("DEFAULT_COPIES")
            or ""
        ).strip()
        is_active = _boolish(row.get("is_active", row.get("IS_ACTIVE", True)), True)
        if not any([gtin, desc, length_in, width_in, height_in, gross_weight_lbs, sku, case_qty, default_copies]) and packaging_level == "Other":
            continue
        out.append({
            "line": row.get("line") or idx,
            "storefront": storefront,
            "in_packing_list": in_packing_list,
            "gtin": gtin,
            "description": desc,
            "packaging_level": packaging_level,
            "length_in": length_in,
            "width_in": width_in,
            "height_in": height_in,
            "gross_weight_lbs": gross_weight_lbs,
            "case_qty": case_qty,
            "default_copies": default_copies,
            "sku": sku,
            "is_active": is_active,
        })
    return out


def _product_master_lookup(rows: List[Dict[str, Any]], *, packing_list_only: bool = False) -> Dict[str, Dict[str, Any]]:
    lookup: Dict[str, Dict[str, Any]] = {}
    for row in _normalize_product_master_rows(rows):
        if packing_list_only and not row.get("in_packing_list"):
            continue
        for value in (row.get("gtin"), row.get("sku")):
            key = _canonical_id(value)
            if key:
                lookup.setdefault(key, row)
        sku_key = str(row.get("sku") or "").strip().lower()
        if sku_key:
            lookup.setdefault("sku:" + sku_key, row)
    return lookup


def _match_product_master_row(item: Dict[str, Any], rows: List[Dict[str, Any]], *, packing_list_only: bool = False) -> Optional[Dict[str, Any]]:
    lookup = _product_master_lookup(rows, packing_list_only=packing_list_only)
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
            if packing_list_only and not row.get("in_packing_list"):
                continue
            if _normalize(row.get("description") or "") == desc:
                return row
    return None


def _find_product_packaging_sibling(
    product: Dict[str, Any],
    rows: List[Dict[str, Any]],
    packaging_level: str,
) -> Optional[Dict[str, Any]]:
    """Find one packaging row in the same Storefront + SKU product group."""
    wanted_sku = str(product.get("sku") or "").strip().lower()
    wanted_storefront = str(product.get("storefront") or "KeHE").strip().lower() or "kehe"
    wanted_level = _normalize_packaging_level(packaging_level)
    if not wanted_sku:
        return None

    matches: List[Dict[str, Any]] = []
    seen_gtins: set[str] = set()
    for row in _normalize_product_master_rows(rows):
        if _normalize_packaging_level(row.get("packaging_level")) != wanted_level:
            continue
        if str(row.get("sku") or "").strip().lower() != wanted_sku:
            continue
        row_storefront = str(row.get("storefront") or "KeHE").strip().lower() or "kehe"
        if row_storefront != wanted_storefront:
            continue
        gtin = str(row.get("gtin") or "").strip()
        if not gtin:
            continue
        canonical_gtin = _canonical_id(gtin)
        if canonical_gtin in seen_gtins:
            continue
        seen_gtins.add(canonical_gtin)
        matches.append(row)
    return matches[0] if len(matches) == 1 else None


def _qty_value(value: Any) -> float:
    parsed = _parse_float(value)
    return parsed if parsed is not None else 0.0


def _apply_product_row_to_item(
    item: Dict[str, Any],
    product: Dict[str, Any],
    each_product: Optional[Dict[str, Any]] = None,
) -> None:
    each_gtin = str((each_product or {}).get("gtin") or "").strip()
    # KeHE's MPL Item Number is the consumer-unit (Each) GTIN. The Case GTIN
    # remains in gtin/case_upc for case identification and label generation.
    item["item_number"] = each_gtin
    item["each_gtin"] = each_gtin
    if product.get("gtin"):
        item["gtin"] = product.get("gtin", "")
        item["case_upc"] = product.get("gtin", "")
    if product.get("sku"):
        item["sku"] = product.get("sku", "")
    if product.get("description") and not _mpl_clean(item.get("description")):
        item["description"] = product.get("description", "")
    item["packaging_level"] = product.get("packaging_level", "")
    item["length_in"] = product.get("length_in", "")
    item["width_in"] = product.get("width_in", "")
    item["height_in"] = product.get("height_in", "")
    item["dimensions_in"] = _product_dimensions_display(product)
    item["unit_weight_lbs"] = product.get("gross_weight_lbs", "")
    unit_weight = _parse_float(product.get("gross_weight_lbs"))
    if unit_weight is not None:
        item["calculated_weight_lbs"] = _format_lbs(unit_weight * _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty")))


def apply_product_master_to_mpl_draft(draft: Dict[str, Any], *, force: bool = False) -> Dict[str, Any]:
    """Fill MPL line-item metadata and blank pallet weights from product master rows.

    Manual pallet weights are preserved unless force=True. Frontend users can still
    override the generated values before rendering.
    """
    product_rows = _normalize_product_master_rows(draft.get("product_master") or draft.get("product_master_rows") or [])
    draft["product_master"] = product_rows

    for mpl in draft.get("packing_lists") or []:
        items = mpl.get("items") or []
        pallet_totals: Dict[str, float] = {}
        existing_warnings = [
            str(warning)
            for warning in (mpl.get("warnings") or [])
            if "required for MPL Item Number" not in str(warning)
        ]
        mpl["warnings"] = existing_warnings
        for item in items:
            product = _match_product_master_row(item, product_rows, packing_list_only=True)
            if not product:
                has_identity = any(
                    _mpl_clean(item.get(key))
                    for key in ("item_number", "sku", "gtin", "case_upc", "upc", "description")
                )
                if has_identity:
                    identity = (
                        _mpl_clean(item.get("sku"))
                        or _mpl_clean(item.get("gtin"))
                        or _mpl_clean(item.get("case_upc"))
                        or _mpl_clean(item.get("upc"))
                        or _mpl_clean(item.get("item_number"))
                        or "Unknown item"
                    )
                    item["item_number"] = ""
                    item["each_gtin"] = ""
                    warning = (
                        f"Item {identity}: enabled Product Master Case row and related Each GTIN "
                        "are required for MPL Item Number."
                    )
                    if warning not in mpl["warnings"]:
                        mpl["warnings"].append(warning)
                    mpl["status"] = "Needs Review"
                continue
            each_product = _find_product_packaging_sibling(product, product_rows, "Each")
            _apply_product_row_to_item(item, product, each_product)
            if not each_product:
                sku = str(product.get("sku") or item.get("sku") or "").strip() or "Unknown SKU"
                warning = f"SKU {sku}: Product Master Each row with a GTIN is required for MPL Item Number."
                if warning not in mpl["warnings"]:
                    mpl["warnings"].append(warning)
                mpl["status"] = "Needs Review"
            unit_weight = _parse_float(product.get("gross_weight_lbs"))
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


def _validate_mpl_each_item_numbers(draft: Dict[str, Any]) -> None:
    missing: List[str] = []
    for mpl in draft.get("packing_lists") or []:
        for item in mpl.get("items") or []:
            has_identity = any(
                _mpl_clean(item.get(key))
                for key in ("sku", "gtin", "case_upc", "upc", "description")
            )
            if not has_identity or _mpl_clean(item.get("item_number")):
                continue
            identity = (
                _mpl_clean(item.get("sku"))
                or _mpl_clean(item.get("gtin"))
                or _mpl_clean(item.get("case_upc"))
                or _mpl_clean(item.get("upc"))
                or f"Line {_mpl_clean(item.get('line')) or '?'}"
            )
            if identity not in missing:
                missing.append(identity)
    if missing:
        shown = ", ".join(missing[:8])
        suffix = f" and {len(missing) - 8} more" if len(missing) > 8 else ""
        raise ValueError(
            "MPL generation blocked: Item Number must be the Product Master Each GTIN. "
            f"Add one unique Each row with a GTIN for: {shown}{suffix}."
        )


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
            "ship_from": _dc_ship_from_str(dc_info, header, packs),
            "warnings": "; ".join(header.get("warnings", [])),
        })
        for pack_index, pack in enumerate(packs, start=1):
            for line, item in enumerate(pack.items or [], start=1):
                items.append({
                    "source_file": header.get("source_file", ""),
                    "dc": dc_info.get("dc", "") if dc_info else "Unknown",
                    "po": item.retailer_item or pack.po or header.get("customer_po_number", ""),
                    "customer_po_number": item.po or pack.po or header.get("customer_po_number", ""),
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
        preserve_pack_pallets = bool(header.get("xml_total_pallets") or header.get("has_tare_pallets"))
        if not preserve_pack_pallets:
            total_pallets = "1"
        pallet_ids = _pallet_ids_for_total(total_pallets) if preserve_pack_pallets else ["1"]

        mpl_warnings: List[str] = list(header.get("warnings", []))
        palletization_source = "XML"
        palletization_note = "Using palletization from XML." if preserve_pack_pallets else (
            "XML did not include item-to-pallet assignment, so all line items were placed on Pallet 1 by default."
        )

        ship_from = _dc_ship_from_str(dc_info, header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)

        # Correct XML with HL03=T or TD101=PLT means each physical SSCC is a pallet.
        # Preserve that parent/child XML relationship. Do not round-robin distribute
        # aggregated item rows across pallets.
        if preserve_pack_pallets and len(packs) != _safe_positive_int(total_pallets, 1):
            mpl_warnings.append(
                f"XML says Total Pallets={total_pallets}, but {len(packs)} physical SSCC pallet records were found. Verify pallet grouping."
            )
        items = _aggregate_mpl_items_for_editor(
            packs,
            mpl_warnings,
            total_pallets=total_pallets,
            preserve_pack_pallets=preserve_pack_pallets,
            default_pallet="1",
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
            "template_id": "kehe",
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
            "xml_total_pallets": header.get("xml_total_pallets", ""),
            "palletization_source": palletization_source,
            "palletization_note": palletization_note,
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
        "template_id": "kehe",
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
_PACK_LABEL_PLACEMENT_NOTE = (
    "Apply GTIN-14 labels on at least two sides of each case, including the longest side; "
    "place the barcode at least 0.25 in from the case-wall edge and 1.25 in from the case bottom."
)


def _pack_label_kind(packaging_level: str) -> str:
    level = _normalize_packaging_level(packaging_level)
    if level == "Inner Pack":
        return "IP"
    if level == "Case":
        return "MP"
    return "OTHER"


def _is_kehe_pack_label_eligible(product: Dict[str, Any]) -> bool:
    level = _normalize_packaging_level(product.get("packaging_level"))
    return (
        _boolish(product.get("is_active", True), True)
        and level in {"Case", "Inner Pack"}
        and bool(str(product.get("gtin") or "").strip())
    )


def _xml_case_qty(item: Dict[str, Any]) -> int:
    qty = _qty_value(item.get("qty") or item.get("qty_on_pallet") or item.get("total_shipped"))
    if qty <= 0:
        return 1
    return max(1, int(round(qty)))


def _product_case_qty(product: Dict[str, Any]) -> int:
    parsed = _parse_float(product.get("case_qty"))
    if parsed is not None and parsed > 0:
        return max(1, int(round(parsed)))
    level = _normalize_packaging_level(product.get("packaging_level"))
    if level == "Inner Pack":
        return 6
    if level == "Case":
        return 1
    return 1


def _default_copies(product: Dict[str, Any]) -> int:
    parsed = _parse_float(product.get("default_copies"))
    level = _normalize_packaging_level(product.get("packaging_level"))
    if parsed is not None and parsed > 0:
        count = max(1, int(round(parsed)))
        return max(2, count) if level in {"Case", "Inner Pack"} else count
    if level == "Inner Pack":
        return 6
    if level == "Case":
        return 2
    return 1


def _same_sku(left: Dict[str, Any], right: Dict[str, Any]) -> bool:
    return bool(str(left.get("sku") or "").strip()) and str(left.get("sku") or "").strip().lower() == str(right.get("sku") or "").strip().lower()


def _find_product_rows_for_xml_item(item: Dict[str, Any], product_rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Return Case row plus related Inner Pack row(s) for an XML item.

    Matching stays aligned with the existing lookup order: XML GTIN/case UPC/UPC/item/SKU,
    then description fallback. Inner Pack rows are derived by SKU from the matched Case row.
    """
    printable = [row for row in product_rows if _is_kehe_pack_label_eligible(row)]
    case_rows = [row for row in printable if _normalize_packaging_level(row.get("packaging_level")) == "Case"]
    inner_rows = [row for row in printable if _normalize_packaging_level(row.get("packaging_level")) == "Inner Pack"]

    case_product = None
    for row in case_rows:
        if _match_product_master_row(item, [row]):
            case_product = row
            break

    if case_product is None:
        return [], None

    related = [case_product]
    for inner in inner_rows:
        if _same_sku(case_product, inner):
            related.append(inner)
    return related, case_product


def build_kehe_pack_label_draft(
    xml_paths: List[str],
    product_master_rows: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Parse XML and product master rows into editable 4 x 4 pack label drafts.

    Only XML-present Case/MP products are output. If the same SKU has an Inner Pack/IP
    row in the master table, related IP labels are also output. Copies are controlled by
    the Product Master Default Copies value. Case Qty prints from Product Master.
    """
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
                "is_active": True,
                "gtin": gtin,
                "description": item.get("description", ""),
                "packaging_level": "Case",
                "length_in": "",
                "width_in": "",
                "height_in": "",
                "gross_weight_lbs": "",
                "case_qty": "1",
                "default_copies": "2",
                "sku": item.get("item_number", ""),
            })

    labels: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if duplicate_files:
        warnings.append(f"Duplicate file(s) skipped: {', '.join(duplicate_files)}")

    label_accumulator: Dict[Tuple[str, str, str, str, str], Dict[str, Any]] = {}

    for item in extracted_items:
        matched_products, case_product = _find_product_rows_for_xml_item(item, product_rows)
        if not matched_products or not case_product:
            continue

        xml_cases = _xml_case_qty(item)
        lot = item.get("lot", "")
        best_before = item.get("expiration_date", "")
        source_file = item.get("source_file", "")

        for product in matched_products:
            level = _normalize_packaging_level(product.get("packaging_level"))
            kind = _pack_label_kind(level)
            if kind not in ("MP", "IP"):
                continue

            label_warnings: List[str] = []
            gtin = _gtin14(product.get("gtin"))
            if len(_only_digits(gtin)) != 14:
                label_warnings.append("GTIN must be 14 digits for ITF-14.")
            if not product.get("description"):
                label_warnings.append("Description is blank.")
            if not product.get("gross_weight_lbs"):
                label_warnings.append("Weight is blank.")

            default_copies = _default_copies(product)
            copies = max(1, xml_cases * default_copies)
            case_qty = str(_product_case_qty(product))

            key = (
                gtin,
                level,
                str(lot or ""),
                str(best_before or ""),
                str(source_file or ""),
            )

            if key in label_accumulator:
                existing = label_accumulator[key]
                existing["copies"] = int(existing.get("copies") or 0) + copies
                continue

            label = {
                "id": f"{kind}-{len(labels) + 1}",
                "status": "Needs Review" if label_warnings else "Ready",
                "print_selected": True,
                "matched_in_xml": True,
                "gtin": gtin,
                "description": product.get("description", ""),
                "brand": "",
                "packaging_level": level,
                "pack_prefix": kind,
                "length_in": product.get("length_in", ""),
                "width_in": product.get("width_in", ""),
                "height_in": product.get("height_in", ""),
                "dimensions_in": _product_dimensions_display(product),
                "gross_weight_lbs": product.get("gross_weight_lbs", ""),
                "sku": product.get("sku", ""),
                "lot": lot,
                "best_before": best_before,
                "case_qty": case_qty,
                "default_copies": str(default_copies),
                "copies": copies,
                "source_file": source_file,
                "warnings": label_warnings,
            }
            label_accumulator[key] = label
            labels.append(label)

    if not labels:
        warnings.append("No active Case/MP rows with a GTIN were matched from the uploaded XML.")

    return {
        "document_type": "kehe_pack_labels",
        "version": 2,
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


_ITF14_DIGIT_PATTERNS = {
    "0": "nnwwn",
    "1": "wnnnw",
    "2": "nwnnw",
    "3": "wwnnn",
    "4": "nnwnw",
    "5": "wnwnn",
    "6": "nwwnn",
    "7": "nnnww",
    "8": "wnnwn",
    "9": "nwnwn",
}


def _itf14_runs(value: str, wide_ratio: float = 2.5) -> Tuple[List[Tuple[bool, float]], float]:
    runs: List[Tuple[bool, float]] = []

    def _append(is_bar: bool, width_code: str) -> None:
        runs.append((is_bar, wide_ratio if width_code == "w" else 1.0))

    # Start: narrow bar, narrow space, narrow bar, narrow space.
    for is_bar in (True, False, True, False):
        _append(is_bar, "n")

    for index in range(0, len(value), 2):
        bars = _ITF14_DIGIT_PATTERNS.get(value[index], _ITF14_DIGIT_PATTERNS["0"])
        spaces = _ITF14_DIGIT_PATTERNS.get(value[index + 1], _ITF14_DIGIT_PATTERNS["0"])
        for bar_code, space_code in zip(bars, spaces):
            _append(True, bar_code)
            _append(False, space_code)

    # Stop: wide bar, narrow space, narrow bar.
    _append(True, "w")
    _append(False, "n")
    _append(True, "n")
    total_units = sum(width for _is_bar, width in runs)
    return runs, total_units


def _draw_itf14_centered(c: canvas.Canvas, gtin14: str, x: float, y: float, w: float, h: float) -> None:
    """Draw GTIN-14 as ITF-14.

    ITF-14 uses Interleaved 2 of 5 as the barcode symbology, but the
    case-label presentation needs bearer bars around the barcode.
    """
    value = _gtin14(gtin14)
    if not value:
        return

    # ITF / Interleaved 2 of 5 encodes digit pairs.
    # Valid GTIN-14 is already even length, but keep this fallback safe.
    if len(value) % 2:
        value = "0" + value

    # Bearer bars for ITF-14 case/carton scanning.
    bearer_h = 0.16 * inch
    side_bearer_w = 0.20 * inch
    quiet_zone = 0.25 * inch

    panel_x = x + side_bearer_w
    panel_y = y + bearer_h
    panel_w = max(0.25 * inch, w - (2 * side_bearer_w))
    panel_h = max(0.30 * inch, h - (2 * bearer_h))
    inner_x = panel_x + quiet_zone
    inner_y = y + bearer_h
    inner_w = max(0.25 * inch, panel_w - (2 * quiet_zone))
    inner_h = panel_h

    runs, total_units = _itf14_runs(value)
    unit_w = inner_w / total_units if total_units else 0.0

    # Filled bearer frame, then white symbol field inside it.
    c.setFillColorRGB(0, 0, 0)
    c.rect(x, y, w, h, stroke=0, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.rect(panel_x, panel_y, panel_w, panel_h, stroke=0, fill=1)

    c.setFillColorRGB(0, 0, 0)
    cursor = inner_x
    for is_bar, width_units in runs:
        run_w = width_units * unit_w
        if is_bar and run_w > 0:
            c.rect(cursor, inner_y, run_w, inner_h, stroke=0, fill=1)
        cursor += run_w


def _draw_pack_label_page(c: canvas.Canvas, label: Dict[str, Any]) -> None:
    W, H = _PACK_LABEL_PAGE
    c.setFillColorRGB(1, 1, 1)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.2)
    c.rect(0.02 * inch, 0.02 * inch, W - 0.04 * inch, H - 0.04 * inch)

    desc = str(label.get("description") or "").upper().strip()
    title_font = 19
    title_lines = wrap_text(desc, "Helvetica-Bold", title_font, W - 0.22 * inch, max_lines=3)
    y = H - 0.30 * inch
    c.setFillColorRGB(0, 0, 0)
    for line in title_lines:
        c.setFont("Helvetica-Bold", title_font)
        c.drawCentredString(W / 2, y, line)
        y -= 0.32 * inch

    lot = str(label.get("lot") or "").strip()
    best_before = _format_label_date_mmddyyyy(str(label.get("best_before") or ""))
    row_y = 3.04 * inch
    c.setFont("Helvetica-Bold", 14)
    c.drawString(0.34 * inch, row_y, f"LOT# {lot}" if lot else "LOT#")

    c.setFont("Helvetica-Bold", 14)
    c.drawString(1.76 * inch, row_y, "Best Before:")

    c.setFont("Helvetica", 14)
    c.drawString(3.00 * inch, row_y, best_before)

    # `weight_lbs` is retained only as a historical pack-label draft adapter.
    weight = str(label.get("gross_weight_lbs") or label.get("weight_lbs") or "").strip()
    weight_display = _format_lbs(_parse_float(weight)) if weight else ""
    weight_y = 2.58 * inch
    c.setFont("Helvetica-Bold", 23)
    c.drawRightString(2.10 * inch, weight_y, "WEIGHT:")
    c.setFont("Helvetica", 23)
    c.drawString(2.20 * inch, weight_y, weight_display or weight)

    kind = str(label.get("pack_prefix") or _pack_label_kind(label.get("packaging_level"))).upper()
    qty = str(label.get("case_qty") or "").strip()
    qty_y = 2.24 * inch
    c.setFont("Helvetica-Bold", 23)
    c.drawRightString(2.40 * inch, qty_y, f"{kind} Case Qty:")
    c.setFont("Helvetica", 23)
    c.drawString(2.50 * inch, qty_y, f"{qty} Units" if qty else "Units")

    # ITF-14 barcode with bearer bars and continuous human-readable GTIN.
    gtin = _only_digits(label.get("gtin", ""))

    bx = 0.30 * inch
    bw = W - 0.60 * inch

    hri_strip_h = 0.34 * inch
    hri_y = 0.06 * inch

    barcode_y = hri_y + hri_strip_h
    barcode_h = 1.72 * inch

    # White barcode/HRI panel.
    c.setFillColorRGB(1, 1, 1)
    c.rect(bx, hri_y, bw, hri_strip_h + barcode_h, stroke=0, fill=1)

    _draw_itf14_centered(
        c,
        gtin,
        bx,
        barcode_y,
        bw,
        barcode_h,
    )

    # Human-readable text strip.
    c.setFillColorRGB(1, 1, 1)
    c.rect(bx, hri_y, bw, hri_strip_h, stroke=0, fill=1)

    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica", 21)
    c.drawCentredString(W / 2, hri_y + 0.07 * inch, gtin if gtin else "")


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
        if label["pack_prefix"] in {"MP", "IP"}:
            copies = max(2, copies)
            label["copies"] = copies
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
            "gross_weight_lbs": label.get("gross_weight_lbs", label.get("weight_lbs", "")),
            "case_qty": label.get("case_qty", ""),
            "copies": copies,
            "note": "; ".join(warnings) if warnings else _PACK_LABEL_PLACEMENT_NOTE,
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
_MPL_NAVY = (0.09, 0.21, 0.36)
_MPL_BLUE_LIGHT = (0.86, 0.92, 0.99)
_MPL_BLUE_PALE = (0.97, 0.985, 1.0)
_MPL_TEAL = (0.07, 0.37, 0.35)
_MPL_TEAL_LIGHT = (0.80, 0.98, 0.95)
_MPL_TEAL_PALE = (0.97, 1.0, 0.99)
_MPL_PALLET_LENGTH_IN = 48.0
_MPL_PALLET_WIDTH_IN = 40.0
_MPL_PALLET_MAX_HEIGHT_IN = 70.0
_MPL_PALLET_MAX_GROSS_LBS = 2000.0
_MPL_PALLET_TARE_LBS = 50.0
_MPL_PALLET_BUFFER_FACTOR = 1.05


def _mpl_template_id(draft: Dict[str, Any], mpl: Dict[str, Any]) -> str:
    """Resolve allowed MPL templates while keeping KeHE XML drafts locked."""
    if not bool(draft.get("standalone_mpl")):
        mpl["template_id"] = "kehe"
        return "kehe"
    requested = _mpl_clean(mpl.get("template_id") or draft.get("template_id") or "standard").lower()
    template_id = requested if requested in {"kehe", "standard", "compact"} else "standard"
    mpl["template_id"] = template_id
    return template_id


def _mpl_template_theme(template_id: str) -> Dict[str, Any]:
    if template_id == "standard":
        return {
            "title": "PACKING LIST",
            "primary": _MPL_NAVY,
            "label_fill": _MPL_BLUE_LIGHT,
            "value_fill": _MPL_BLUE_PALE,
            "row_alt": (0.95, 0.975, 1.0),
            "compact": False,
        }
    if template_id == "compact":
        return {
            "title": "COMPACT PACKING LIST",
            "primary": _MPL_TEAL,
            "label_fill": _MPL_TEAL_LIGHT,
            "value_fill": _MPL_TEAL_PALE,
            "row_alt": (0.94, 0.99, 0.98),
            "compact": True,
        }
    return {
        "title": "MASTER PACKING LIST",
        "primary": _MPL_BLACK,
        "label_fill": _MPL_GREY,
        "value_fill": _MPL_CREAM,
        "row_alt": _MPL_ROW_ALT,
        "compact": False,
    }


def _mpl_tihi_constraints(mpl: Optional[Dict[str, Any]] = None, pallet: str = "") -> Dict[str, float]:
    raw = (mpl or {}).get("_tihi_constraints") or {}
    pallet_key = _mpl_clean(pallet)
    pallet_constraints = (mpl or {}).get("_tihi_pallet_constraints") or {}
    if pallet_key and isinstance(pallet_constraints, dict) and isinstance(pallet_constraints.get(pallet_key), dict):
        raw = pallet_constraints.get(pallet_key) or {}
    def _positive(value: Any, fallback: float) -> float:
        parsed = _parse_float(value)
        return parsed if parsed is not None and parsed > 0 else fallback
    return {
        "max_length_in": _positive(raw.get("max_length_in"), _MPL_PALLET_LENGTH_IN),
        "max_width_in": _positive(raw.get("max_width_in"), _MPL_PALLET_WIDTH_IN),
        "max_height_in": _positive(raw.get("max_height_in"), _MPL_PALLET_MAX_HEIGHT_IN),
        "max_gross_lbs": _positive(raw.get("max_gross_lbs"), _MPL_PALLET_MAX_GROSS_LBS),
    }


def _mpl_tihi_snapshot_payload(mpl: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    raw = mpl.get("_tihi_snapshot")
    if not isinstance(raw, dict):
        return None
    entries = raw.get("entries")
    warnings = raw.get("warnings")
    if not isinstance(entries, list):
        return None
    constraints = _mpl_tihi_constraints({"_tihi_constraints": raw.get("constraints") or mpl.get("_tihi_constraints") or {}})
    return {
        "entries": entries,
        "warnings": [str(warning) for warning in (warnings or [])],
        "constraints": constraints,
        "sheet_image_data_url": _mpl_clean(raw.get("sheet_image_data_url")),
    }


def _mpl_snapshot_image_reader(image_data_url: str) -> Optional[ImageReader]:
    raw = _mpl_clean(image_data_url)
    if not raw or not raw.startswith("data:image/"):
        return None
    try:
        _, encoded = raw.split(",", 1)
        return ImageReader(io.BytesIO(base64.b64decode(encoded)))
    except Exception:
        return None


def _draw_mpl_snapshot_page(c: canvas.Canvas, reader: ImageReader) -> bool:
    img_w, img_h = reader.getSize()
    if img_w <= 0 or img_h <= 0:
        return False
    page_w, page_h = A4
    margin = 0.40 * inch
    max_w = page_w - (2 * margin)
    max_h = page_h - (2 * margin)
    scale = min(max_w / img_w, max_h / img_h)
    draw_w = img_w * scale
    draw_h = img_h * scale
    draw_x = (page_w - draw_w) / 2
    draw_y = (page_h - draw_h) / 2
    c.drawImage(reader, draw_x, draw_y, width=draw_w, height=draw_h, preserveAspectRatio=True, mask='auto')
    c.showPage()
    return True


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


def _draw_info_cell(
    c: canvas.Canvas,
    x: float,
    top_y: float,
    w: float,
    h: float,
    label: str,
    value: str,
    theme: Optional[Dict[str, Any]] = None,
) -> None:
    theme = theme or _mpl_template_theme("kehe")
    label_h = h * 0.42
    _draw_mpl_cell(c, x, top_y - h, w, h, theme["value_fill"], _MPL_GRID, 0.4)
    _draw_mpl_cell(c, x, top_y - label_h, w, label_h, theme["label_fill"], _MPL_GRID, 0.4)

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

def _render_mpl_header(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    page_num: int,
    total_pages: int,
    template_id: str = "kehe",
) -> float:
    """Draw MPL header block; return y position below header."""
    theme = _mpl_template_theme(template_id)
    compact = bool(theme["compact"])
    x0 = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    y = _MPL_INNER_TOP

    # Title bar.
    title_h = (0.20 if compact else 0.23) * inch
    _draw_mpl_cell(c, x0, y - title_h, inner_w, title_h, theme["primary"], theme["primary"], 0.6)
    c.setFont("Helvetica-Bold", 10)
    c.setFillColorRGB(1, 1, 1)
    title = theme["title"] if template_id != "kehe" else (mpl.get("title") or theme["title"])
    c.drawCentredString(x0 + inner_w / 2, y - title_h / 2 - 3.0, title)
    y -= title_h + (0.07 if compact else 0.12) * inch

    if mpl.get("status") == "Needs Review":
        warning = (
            "NEEDS REVIEW - Unknown KeHE DC. Verify addresses before using."
            if template_id == "kehe"
            else "NEEDS REVIEW - Verify order, address, and pallet details before using."
        )
        y = _draw_warning_box(
            c,
            warning,
            x0,
            y,
            inner_w,
            font_size=6.5,
            padding=4,
        ) - 0.05 * inch

    # Top requirement grid.
    def draw_info_row(
        cells: List[Tuple[str, str, float]],
        row_h: float = (0.24 if compact else 0.28) * inch,
    ) -> None:
        nonlocal y
        cx = x0
        for label, value, rel_w in cells:
            cw = inner_w * rel_w
            _draw_info_cell(c, cx, y, cw, row_h, label, value, theme)
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

    y -= (0.09 if compact else 0.16) * inch

    # Address blocks.
    addr_h = (0.72 if compact else 0.93) * inch
    col_gap = (0.07 if compact else 0.12) * inch
    col_w = (inner_w - 2 * col_gap) / 3
    addr_cells = [
        ("SUPPLIER INFO:", mpl.get("supplier_info", "")),
        ("BILL TO:", mpl.get("bill_to", "")),
        ("SHIP TO:", mpl.get("ship_to", "")),
    ]
    for idx, (label, value) in enumerate(addr_cells):
        cx = x0 + idx * (col_w + col_gap)
        _draw_mpl_cell(c, cx, y - addr_h, col_w, addr_h, theme["value_fill"], _MPL_GRID, 0.35)
        header_h = (0.18 if compact else 0.22) * inch
        _draw_mpl_cell(c, cx, y - header_h, col_w, header_h, theme["label_fill"], _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        c.setFont("Helvetica-Bold", 7)
        c.drawCentredString(cx + col_w / 2, y - header_h / 2 - 2.7, label)
        address_font = 6.2 if compact else 6.8
        c.setFont("Helvetica", address_font)
        lines: List[str] = []
        for raw in _mpl_clean(value).split("\n"):
            lines.extend(wrap_text(raw, "Helvetica", address_font, col_w - 12, max_lines=2) or [""])
        ty = y - header_h - (0.09 if compact else 0.12) * inch
        for line in lines[:(4 if compact else 5)]:
            c.drawCentredString(cx + col_w / 2, ty, line)
            ty -= 7 if compact else 8
    y -= addr_h + (0.09 if compact else 0.16) * inch

    # Customer / Ship Date / Shipping Instructions bar.
    header_h = (0.15 if compact else 0.18) * inch
    value_h = (0.23 if compact else 0.28) * inch
    cells = [
        ("Customer No", _mpl_clean(mpl.get("customer_no") or mpl.get("customer_po_number")), 0.25),
        ("Ship Date", _mpl_date_short(_mpl_clean(mpl.get("est_ship_date"))), 0.25),
        ("Shipping Instructions", _mpl_clean(mpl.get("shipping_instructions")), 0.50),
    ]
    cx = x0
    for label, _value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - header_h, cw, header_h, theme["primary"], theme["primary"], 0.35)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 6.4)
        c.drawCentredString(cx + cw / 2, y - header_h / 2 - 2.3, label)
        cx += cw
    y -= header_h
    cx = x0
    for _label, value, rel in cells:
        cw = inner_w * rel
        _draw_mpl_cell(c, cx, y - value_h, cw, value_h, theme["value_fill"], _MPL_GRID, 0.35)
        c.setFillColorRGB(0, 0, 0)
        _draw_centered_wrapped(c, value, cx, y - value_h / 2, cw, "Helvetica", 7, max_lines=1)
        cx += cw
    y -= value_h + (0.13 if compact else 0.22) * inch

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)
    return y


def _render_mpl_table_header(c: canvas.Canvas, y: float, template_id: str = "kehe") -> float:
    theme = _mpl_template_theme(template_id)
    th = (0.30 if theme["compact"] else 0.36) * inch
    _draw_mpl_cell(c, _MPL_MARGIN, y - th, _MPL_INNER_W, th, theme["primary"], theme["primary"], 0.45)

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

def _mpl_item_height(item: Dict[str, Any], template_id: str = "kehe") -> float:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    desc = _mpl_clean(item.get("description"))
    desc_lines = (
        wrap_text(desc.upper(), "Helvetica-Bold", 7.2 if compact else 7.8, _MPL_INNER_W * 0.39 - 10, max_lines=4)
        if desc else []
    )

    # A4 has enough height. Use taller rows instead of compressed rows.
    extra = max(0, len(desc_lines) - 1) * (0.10 if compact else 0.13) * inch

    if _mpl_clean(item.get("expiration_date")):
        extra += (0.10 if compact else 0.13) * inch

    return max((0.36 if compact else 0.46) * inch, (0.33 if compact else 0.42) * inch + extra)

def _render_mpl_item_row(
    c: canvas.Canvas,
    item: Dict[str, Any],
    y: float,
    row_h: float,
    bg_rgb: Tuple[float, float, float],
    template_id: str = "kehe",
) -> float:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, bg_rgb, _MPL_GRID, 0.30)

    for key, _label, x, w in _mpl_col_widths():
        c.setStrokeColorRGB(_MPL_GRID[0], _MPL_GRID[1], _MPL_GRID[2])
        c.setLineWidth(0.30)
        c.line(x, y - row_h, x, y)

        if key == "_description_block":
            desc = _mpl_clean(item.get("description")).upper()
            exp = _mpl_exp_short(_mpl_clean(item.get("expiration_date")))

            ty = y - (0.11 if compact else 0.14) * inch
            c.setFillColorRGB(0, 0, 0)

            ty = _draw_wrapped_left(
                c,
                desc,
                x + 5,
                ty,
                w - 10,
                "Helvetica-Bold",
                7.2 if compact else 7.8,
                max_lines=4,
                leading=8.0 if compact else 8.9,
            )

            meta_y = max(y - row_h + 0.09 * inch, ty - 0.02 * inch)
            c.setFont("Helvetica-Oblique", 6.6 if compact else 7.2)

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
                7.2 if compact else 7.8,
                max_lines=1,
                leading=8.5,
            )

    last_x = _MPL_MARGIN + _MPL_INNER_W
    c.line(last_x, y - row_h, last_x, y)
    return y - row_h

def _render_mpl_pallet_group_row(
    c: canvas.Canvas,
    y: float,
    row_h: float,
    pallet_num: str,
    pallet_weight: str,
    template_id: str = "kehe",
) -> float:
    theme = _mpl_template_theme(template_id)
    _draw_mpl_cell(c, _MPL_MARGIN, y - row_h, _MPL_INNER_W, row_h, theme["label_fill"], _MPL_GRID, 0.40)

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

def _mpl_build_units(
    items: List[Dict[str, Any]],
    template_id: str = "kehe",
) -> List[Tuple[str, Dict[str, Any], float]]:
    compact = bool(_mpl_template_theme(template_id)["compact"])
    units: List[Tuple[str, Dict[str, Any], float]] = []
    for pallet, rows in _mpl_group_items(items):
        pallet_weight = ""
        for row in rows:
            if _mpl_clean(row.get("pallet_weight")):
                pallet_weight = _mpl_clean(row.get("pallet_weight"))
                break
        units.append(("group", {"pallet": pallet, "pallet_weight": pallet_weight}, (0.26 if compact else 0.32) * inch))
        for row in rows:
            units.append(("item", row, _mpl_item_height(row, template_id)))
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


def _mpl_parse_dimensions_in(value: Any) -> Optional[Tuple[float, float, float]]:
    nums = re.findall(r"\d+(?:\.\d+)?", str(value or "").replace(",", ""))
    if len(nums) < 3:
        return None
    dims = tuple(float(n) for n in nums[:3])
    return dims if all(d > 0 for d in dims) else None


def _mpl_tihi_case_qty(item: Dict[str, Any]) -> int:
    qty = _qty_value(item.get("qty_on_pallet") or item.get("total_shipped") or item.get("qty"))
    if qty <= 0:
        return 0
    return max(1, int(math.ceil(qty)))


def _mpl_tihi_item_label(item: Dict[str, Any]) -> str:
    return (
        _mpl_clean(item.get("sku"))
        or _mpl_clean(item.get("item_number"))
        or _mpl_clean(item.get("gtin"))
        or _mpl_clean(item.get("case_upc"))
        or _mpl_clean(item.get("description"))
        or f"Line {_mpl_clean(item.get('line')) or '?'}"
    )


def _mpl_tihi_color(index: int) -> Tuple[float, float, float]:
    palette = [
        (0.85, 0.60, 0.29),
        (0.49, 0.70, 0.98),
        (0.56, 0.82, 0.62),
        (0.96, 0.64, 0.64),
        (0.72, 0.63, 0.98),
        (0.50, 0.85, 0.82),
        (0.95, 0.81, 0.39),
        (0.94, 0.70, 0.48),
        (0.42, 0.77, 0.63),
        (0.71, 0.83, 0.44),
        (0.95, 0.55, 0.70),
        (0.53, 0.66, 0.96),
        (0.78, 0.62, 0.91),
        (0.44, 0.78, 0.91),
        (0.89, 0.71, 0.44),
        (0.62, 0.75, 0.63),
    ]
    return palette[index % len(palette)]


def _mpl_tihi_color_key(group: Dict[str, Any]) -> str:
    return (
        _canonical_id(group.get("sku") or group.get("item_number") or group.get("gtin"))
        or _normalize(group.get("description") or group.get("label") or "")
    )


def _mpl_best_tihi_orientation(dimensions: Tuple[float, float, float], constraints: Dict[str, float]) -> Optional[Dict[str, float]]:
    length, width, height = dimensions
    candidates: List[Dict[str, float]] = []
    seen: set[Tuple[float, float]] = set()
    for footprint_l, footprint_w in ((length, width), (width, length)):
        key = (footprint_l, footprint_w)
        if key in seen:
            continue
        seen.add(key)
        cols = int(constraints["max_length_in"] // footprint_l)
        rows = int(constraints["max_width_in"] // footprint_w)
        tie = cols * rows
        if tie < 1:
            continue
        fill_ratio = (
            (cols * footprint_l * rows * footprint_w)
            / (constraints["max_length_in"] * constraints["max_width_in"])
        )
        candidates.append({
            "case_length": footprint_l,
            "case_width": footprint_w,
            "case_height": height,
            "columns": cols,
            "rows": rows,
            "tie": tie,
            "fill_ratio": fill_ratio,
        })
    if not candidates:
        return None
    return max(candidates, key=lambda row: (row["tie"], row["fill_ratio"], -row["case_width"]))


def _mpl_round_product_weight_for_pallet(product_weight: float) -> float:
    return math.ceil((product_weight * _MPL_PALLET_BUFFER_FACTOR) / 10.0) * 10.0


def _mpl_tihi_placement_options(dimensions: Tuple[float, float, float]) -> List[Dict[str, Any]]:
    length, width, height = dimensions
    options: List[Dict[str, Any]] = []
    for case_length, case_width, rotated in ((length, width, False), (width, length, True)):
        if any(
            math.isclose(case_length, existing["case_length"], rel_tol=1e-9, abs_tol=1e-9)
            and math.isclose(case_width, existing["case_width"], rel_tol=1e-9, abs_tol=1e-9)
            for existing in options
        ):
            continue
        option = {
            "case_length": case_length,
            "case_width": case_width,
            "case_height": height,
            "rotated": rotated,
        }
        options.append(option)
    return options


def _mpl_score_gt(left: Tuple[float, ...], right: Tuple[float, ...]) -> bool:
    for index in range(max(len(left), len(right))):
        lv = left[index] if index < len(left) else 0.0
        rv = right[index] if index < len(right) else 0.0
        if lv == rv:
            continue
        return lv > rv
    return False


def _mpl_tihi_layer_capacity(group: Dict[str, Any], constraints: Dict[str, float]) -> int:
    orientation = group.get("base_orientation")
    if not orientation:
        orientation = _mpl_best_tihi_orientation(group.get("dimensions") or (0.0, 0.0, 0.0), constraints)
    try:
        return max(1, int((orientation or {}).get("tie") or 1))
    except (TypeError, ValueError):
        return 1


def _mpl_rect_length(rect: Dict[str, Any]) -> float:
    return float(rect["length"] if "length" in rect else rect.get("case_length") or 0.0)


def _mpl_rect_width(rect: Dict[str, Any]) -> float:
    return float(rect["width"] if "width" in rect else rect.get("case_width") or 0.0)


def _mpl_tihi_intersection_area(a: Dict[str, Any], b: Dict[str, Any]) -> float:
    x1 = max(float(a.get("x") or 0.0), float(b.get("x") or 0.0))
    y1 = max(float(a.get("y") or 0.0), float(b.get("y") or 0.0))
    x2 = min(float(a.get("x") or 0.0) + _mpl_rect_length(a), float(b.get("x") or 0.0) + _mpl_rect_length(b))
    y2 = min(float(a.get("y") or 0.0) + _mpl_rect_width(a), float(b.get("y") or 0.0) + _mpl_rect_width(b))
    return max(0.0, x2 - x1) * max(0.0, y2 - y1)


def _mpl_tihi_rects_overlap(a: Dict[str, Any], b: Dict[str, Any]) -> bool:
    return _mpl_tihi_intersection_area(a, b) > 0.001


def _mpl_tihi_top_z(placement: Dict[str, Any]) -> float:
    return float(placement.get("z") or 0.0) + float(placement.get("case_height") or placement.get("height") or 0.0)


def _mpl_tihi_z_overlaps(placement: Dict[str, Any], base_z: float, height: float) -> bool:
    bottom = float(placement.get("z") or 0.0)
    top = _mpl_tihi_top_z(placement)
    return bottom < base_z + height - 0.001 and top > base_z + 0.001


def _mpl_tihi_support_surfaces(
    placements: List[Dict[str, Any]],
    layer_base_z: float,
    constraints: Dict[str, float],
) -> List[Dict[str, float]]:
    if layer_base_z <= 0.001:
        return [{"x": 0.0, "y": 0.0, "length": constraints["max_length_in"], "width": constraints["max_width_in"]}]
    surfaces: List[Dict[str, float]] = []
    for placement in placements:
        top_z = float(placement.get("z") or 0.0) + float(placement.get("case_height") or 0.0)
        if abs(top_z - layer_base_z) <= 0.001:
            surfaces.append({
                "x": float(placement.get("x") or 0.0),
                "y": float(placement.get("y") or 0.0),
                "length": float(placement.get("case_length") or 0.0),
                "width": float(placement.get("case_width") or 0.0),
                "unit_weight": float(placement.get("unit_weight") or 0.0),
            })
    return surfaces


def _mpl_tihi_support_levels(
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
) -> List[float]:
    levels = [0.0]
    for placement in placements:
        top_z = _mpl_tihi_top_z(placement)
        if top_z <= constraints["max_height_in"] + 0.001 and not any(abs(top_z - level) <= 0.001 for level in levels):
            levels.append(top_z)
    return sorted(levels)


def _mpl_tihi_support_ratio(
    placement: Dict[str, Any],
    support_surfaces: List[Dict[str, float]],
    min_support_weight: float = 0.0,
) -> float:
    area = _mpl_rect_length(placement) * _mpl_rect_width(placement)
    if area <= 0:
        return 0.0
    supported_area = sum(
        _mpl_tihi_intersection_area(placement, surface)
        for surface in support_surfaces
        if "unit_weight" not in surface or float(surface.get("unit_weight") or 0.0) + 0.001 >= min_support_weight
    )
    return min(1.0, supported_area / area)


def _mpl_tihi_has_lighter_support_overlap(
    placement: Dict[str, Any],
    support_surfaces: List[Dict[str, float]],
    min_support_weight: float = 0.0,
) -> bool:
    required_weight = float(min_support_weight or 0.0)
    if required_weight <= 0:
        return False
    return any(
        "unit_weight" in surface
        and float(surface.get("unit_weight") or 0.0) + 0.001 < required_weight
        and _mpl_tihi_intersection_area(placement, surface) > 0.001
        for surface in support_surfaces
    )


def _mpl_tihi_candidate_values(raw_values: List[float], max_value: float) -> List[float]:
    values: List[float] = []
    for value in raw_values:
        try:
            n = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(n):
            continue
        clamped = min(max(n, 0.0), max_value)
        if not any(abs(existing - clamped) < 0.001 for existing in values):
            values.append(clamped)
    return sorted(values)


def _mpl_pick_best_layer_placement(
    layer_placements: List[Dict[str, Any]],
    support_surfaces: List[Dict[str, float]],
    dimensions: Tuple[float, float, float],
    constraints: Dict[str, float],
    prefer_rotated: bool = False,
    min_support_weight: float = 0.0,
    blocking_placements: Optional[List[Dict[str, Any]]] = None,
    base_z: float = 0.0,
) -> Optional[Dict[str, Any]]:
    options = _mpl_tihi_placement_options(dimensions)
    best: Optional[Dict[str, Any]] = None
    blockers = blocking_placements if blocking_placements is not None else layer_placements
    for option in options:
        if option["case_length"] > constraints["max_length_in"] or option["case_width"] > constraints["max_width_in"]:
            continue
        max_x = constraints["max_length_in"] - option["case_length"]
        max_y = constraints["max_width_in"] - option["case_width"]
        x_seeds = [0.0, max_x]
        y_seeds = [0.0, max_y]
        for placed in blockers:
            x = float(placed.get("x") or 0.0)
            y = float(placed.get("y") or 0.0)
            x_seeds.extend([x, x + _mpl_rect_length(placed), x - option["case_length"]])
            y_seeds.extend([y, y + _mpl_rect_width(placed), y - option["case_width"]])
        for surface in support_surfaces:
            x = float(surface.get("x") or 0.0)
            y = float(surface.get("y") or 0.0)
            length = float(surface.get("length") or 0.0)
            width = float(surface.get("width") or 0.0)
            x_seeds.extend([x, x + length - option["case_length"], x + length, x - option["case_length"]])
            y_seeds.extend([y, y + width - option["case_width"], y + width, y - option["case_width"]])

        for x in _mpl_tihi_candidate_values(x_seeds, max_x):
            for y in _mpl_tihi_candidate_values(y_seeds, max_y):
                placement = {**option, "x": x, "y": y}
                if any(
                    _mpl_tihi_z_overlaps(existing, base_z, float(option["case_height"]))
                    and _mpl_tihi_rects_overlap(placement, existing)
                    for existing in blockers
                ):
                    continue
                if _mpl_tihi_has_lighter_support_overlap(placement, support_surfaces, min_support_weight):
                    continue
                support_ratio = _mpl_tihi_support_ratio(placement, support_surfaces, min_support_weight)
                if support_ratio < 0.8:
                    continue
                orientation_tie = math.floor(constraints["max_length_in"] / option["case_length"]) * math.floor(constraints["max_width_in"] / option["case_width"])
                score = (
                    1.0 if bool(option.get("rotated")) == prefer_rotated else 0.0,
                    float(orientation_tie),
                    support_ratio,
                    -y,
                    -x,
                )
                if best is None or _mpl_score_gt(score, best["score"]):
                    best = {"placement": placement, "score": score, "support_ratio": support_ratio}
    return best


def _mpl_subtract_rect(rect: Dict[str, float], cover: Dict[str, float]) -> List[Dict[str, float]]:
    x1 = max(rect["x"], cover["x"])
    y1 = max(rect["y"], cover["y"])
    x2 = min(rect["x"] + rect["length"], cover["x"] + cover["length"])
    y2 = min(rect["y"] + rect["width"], cover["y"] + cover["width"])
    if x2 <= x1 or y2 <= y1:
        return [rect]

    pieces: List[Dict[str, float]] = []
    if x1 > rect["x"]:
        pieces.append({"x": rect["x"], "y": rect["y"], "length": x1 - rect["x"], "width": rect["width"]})
    if x2 < rect["x"] + rect["length"]:
        pieces.append({"x": x2, "y": rect["y"], "length": rect["x"] + rect["length"] - x2, "width": rect["width"]})
    middle_length = x2 - x1
    if y1 > rect["y"]:
        pieces.append({"x": x1, "y": rect["y"], "length": middle_length, "width": y1 - rect["y"]})
    if y2 < rect["y"] + rect["width"]:
        pieces.append({"x": x1, "y": y2, "length": middle_length, "width": rect["y"] + rect["width"] - y2})
    return [piece for piece in pieces if piece["length"] > 0.001 and piece["width"] > 0.001]


def _mpl_is_fully_covered_by_higher(
    placement: Dict[str, Any],
    higher_placements: List[Dict[str, Any]],
) -> bool:
    uncovered = [{
        "x": float(placement.get("x") or 0.0),
        "y": float(placement.get("y") or 0.0),
        "length": float(placement.get("case_length") or 0.0),
        "width": float(placement.get("case_width") or 0.0),
    }]
    for higher in higher_placements:
        cover = {
            "x": float(higher.get("x") or 0.0),
            "y": float(higher.get("y") or 0.0),
            "length": float(higher.get("case_length") or 0.0),
            "width": float(higher.get("case_width") or 0.0),
        }
        next_uncovered: List[Dict[str, float]] = []
        for piece in uncovered:
            next_uncovered.extend(_mpl_subtract_rect(piece, cover))
        uncovered = next_uncovered
        if not uncovered:
            return True
    uncovered_area = sum(piece["length"] * piece["width"] for piece in uncovered)
    return uncovered_area <= 0.001


def _mpl_visible_top_placements(placements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    visible: List[Dict[str, Any]] = []
    for placement in placements:
        top_z = float(placement.get("z") or 0.0) + float(placement.get("case_height") or 0.0)
        higher = [
            other for other in placements
            if float(other.get("z") or 0.0) + float(other.get("case_height") or 0.0) > top_z + 0.001
        ]
        if not _mpl_is_fully_covered_by_higher(placement, higher):
            visible.append(placement)
    return sorted(
        visible,
        key=lambda row: (
            float(row.get("z") or 0.0) + float(row.get("case_height") or 0.0),
            int(row.get("layer_index") or 0),
        ),
    )


def _mpl_tihi_pattern_letter(index: int) -> str:
    n = max(0, int(index))
    label = ""
    while True:
        label = chr(65 + (n % 26)) + label
        n = (n // 26) - 1
        if n < 0:
            return label


def _mpl_tihi_layer_signature(layer_placements: List[Dict[str, Any]]) -> str:
    def q(value: Any) -> str:
        return f"{float(value or 0.0):.3f}"

    parts: List[str] = []
    for placement in sorted(
        layer_placements,
        key=lambda p: (
            float(p.get("y") or 0.0),
            float(p.get("x") or 0.0),
            _mpl_clean(p.get("label")),
        ),
    ):
        color = placement.get("color") or ()
        color_key = ",".join(q(v) for v in color) if isinstance(color, (list, tuple)) else str(color)
        parts.append(":".join([
            q(placement.get("x")),
            q(placement.get("y")),
            q(placement.get("case_length")),
            q(placement.get("case_width")),
            q(placement.get("case_height")),
            "R" if placement.get("rotated") else "N",
            _mpl_clean(placement.get("label")),
            color_key,
        ]))
    return "|".join(parts)


def _mpl_build_tihi_layer_patterns(placements: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    layer_buckets: Dict[int, List[Dict[str, Any]]] = {}
    for placement in placements:
        layer_buckets.setdefault(int(placement.get("layer_index") or 0), []).append(placement)

    signature_map: Dict[str, int] = {}
    patterns: List[Dict[str, Any]] = []
    rows: List[Dict[str, Any]] = []
    for layer_index in sorted(layer_buckets.keys()):
        layer = sorted(
            layer_buckets[layer_index],
            key=lambda p: (float(p.get("y") or 0.0), float(p.get("x") or 0.0)),
        )
        signature = _mpl_tihi_layer_signature(layer)
        pattern_index = signature_map.get(signature)
        if pattern_index is None:
            pattern_index = len(patterns)
            signature_map[signature] = pattern_index
            patterns.append({
                "letter": _mpl_tihi_pattern_letter(pattern_index),
                "signature": signature,
                "layers": [],
                "placements": [dict(p) for p in layer],
            })
        pattern = patterns[pattern_index]
        pattern["layers"].append(layer_index + 1)
        z = min((float(p.get("z") or 0.0) for p in layer), default=0.0)
        top = max((float(p.get("z") or 0.0) + float(p.get("case_height") or 0.0) for p in layer), default=z)
        for placement in layer:
            placement["pattern_letter"] = pattern["letter"]
            placement["pattern_index"] = pattern_index
        rows.append({
            "layer_index": layer_index,
            "layer_number": layer_index + 1,
            "letter": pattern["letter"],
            "z": z,
            "height": max(0.0, top - z),
            "placements": layer,
        })
    return patterns, rows


def _mpl_tihi_transform_layer(
    layer: List[Dict[str, Any]],
    constraints: Dict[str, float],
    flip_x: bool,
    flip_y: bool,
) -> List[Dict[str, Any]]:
    transformed: List[Dict[str, Any]] = []
    for placement in layer:
        x = float(placement.get("x") or 0.0)
        y = float(placement.get("y") or 0.0)
        length = float(placement.get("case_length") or 0.0)
        width = float(placement.get("case_width") or 0.0)
        transformed.append({
            **placement,
            "x": max(0.0, constraints["max_length_in"] - x - length) if flip_x else x,
            "y": max(0.0, constraints["max_width_in"] - y - width) if flip_y else y,
        })
    return transformed


def _mpl_tihi_internal_x_edges(layer: List[Dict[str, Any]], max_length: float) -> List[float]:
    edges: List[float] = []
    for placement in layer:
        x = float(placement.get("x") or 0.0)
        length = _mpl_rect_length(placement)
        for edge in (x, x + length):
            if 0.001 < edge < max_length - 0.001:
                edges.append(round(edge, 3))
    return edges


def _mpl_tihi_edge_overlap_score(left_edges: List[float], right_edges: List[float]) -> int:
    score = 0
    used: set[int] = set()
    for left in left_edges:
        for index, right in enumerate(right_edges):
            if index in used:
                continue
            if abs(left - right) <= 0.001:
                score += 1
                used.add(index)
                break
    return score


def _mpl_tihi_layer_variant_valid(
    original_layer: List[Dict[str, Any]],
    candidate_layer: List[Dict[str, Any]],
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
    level_z: float,
) -> bool:
    support_surfaces = _mpl_tihi_support_surfaces(placements, level_z, constraints)
    layer_ids = {id(placement) for placement in original_layer}

    for placement in candidate_layer:
        placement_weight = float(placement.get("unit_weight") or 0.0)
        if _mpl_tihi_has_lighter_support_overlap(placement, support_surfaces, placement_weight):
            return False
        support_ratio = _mpl_tihi_support_ratio(placement, support_surfaces, placement_weight)
        if support_ratio < 0.8:
            return False
        placement["support_ratio"] = support_ratio

    for index, placement in enumerate(candidate_layer):
        for other_index, other in enumerate(candidate_layer):
            if index == other_index:
                continue
            if _mpl_tihi_z_overlaps(other, float(placement.get("z") or 0.0), float(placement.get("case_height") or 0.0)) and _mpl_tihi_rects_overlap(placement, other):
                return False
        for other in placements:
            if id(other) in layer_ids:
                continue
            if _mpl_tihi_z_overlaps(other, float(placement.get("z") or 0.0), float(placement.get("case_height") or 0.0)) and _mpl_tihi_rects_overlap(placement, other):
                return False
    return True


def _mpl_finalize_height_zone_patterns(
    placements: List[Dict[str, Any]],
    constraints: Dict[str, float],
) -> None:
    if not placements:
        return
    levels: List[float] = []
    for placement in placements:
        z = float(placement.get("z") or 0.0)
        if not any(abs(z - level) <= 0.001 for level in levels):
            levels.append(z)
    levels.sort()
    for level_index, level_z in enumerate(levels):
        layer = [placement for placement in placements if abs(float(placement.get("z") or 0.0) - level_z) <= 0.001]
        for placement in layer:
            placement["layer_index"] = level_index

        previous_layers = [
            [placement for placement in placements if abs(float(placement.get("z") or 0.0) - previous_z) <= 0.001]
            for previous_z in levels[max(0, level_index - 3):level_index]
        ]
        previous_edges = [
            _mpl_tihi_internal_x_edges(previous_layer, constraints["max_length_in"])
            for previous_layer in previous_layers
        ]
        previous_signature = _mpl_tihi_layer_signature(previous_layers[-1]) if previous_layers else ""

        variants = [
            (0, False, False),
            (1, True, False),
            (2, False, True),
            (3, True, True),
        ]
        best_variant: Optional[List[Dict[str, Any]]] = None
        best_score: Optional[Tuple[float, ...]] = None
        for transform_index, flip_x, flip_y in variants:
            candidate_layer = _mpl_tihi_transform_layer(layer, constraints, flip_x, flip_y)
            if not _mpl_tihi_layer_variant_valid(layer, candidate_layer, placements, constraints, level_z):
                continue

            candidate_edges = _mpl_tihi_internal_x_edges(candidate_layer, constraints["max_length_in"])
            immediate_penalty = _mpl_tihi_edge_overlap_score(candidate_edges, previous_edges[-1]) if previous_edges else 0
            recent_penalty = sum(_mpl_tihi_edge_overlap_score(candidate_edges, edges) for edges in previous_edges[:-1])
            signature = _mpl_tihi_layer_signature(candidate_layer)
            transform_preference = 1.0 if transform_index == level_index % 4 else 0.0
            score = (
                -float(immediate_penalty * 3 + recent_penalty),
                0.0 if signature == previous_signature else 1.0,
                transform_preference,
                -float(transform_index),
            )
            if best_score is None or _mpl_score_gt(score, best_score):
                best_score = score
                best_variant = candidate_layer

        if best_variant is None:
            continue

        for placement, candidate in zip(layer, best_variant):
            placement["x"] = candidate["x"]
            placement["y"] = candidate["y"]
            placement["support_ratio"] = candidate["support_ratio"]


def _mpl_build_pallet_tihi_layout(groups: List[Dict[str, Any]], constraints: Dict[str, float]) -> Dict[str, Any]:
    placements: List[Dict[str, Any]] = []
    overflow_count = 0

    active_groups = [
        {**group, "remaining_cases": int(group.get("assigned_cases") or 0)}
        for group in sorted(
            groups,
            key=lambda group: (-float(group.get("unit_weight") or 0.0), int(group.get("sort_index") or 0)),
        )
    ]

    while any(group["remaining_cases"] > 0 for group in active_groups):
        candidate: Optional[Dict[str, Any]] = None
        support_levels = _mpl_tihi_support_levels(placements, constraints)
        for group in active_groups:
            if group["remaining_cases"] <= 0:
                continue
            for level_index, base_z in enumerate(support_levels):
                if base_z >= constraints["max_height_in"] - 0.001:
                    continue
                support_surfaces = _mpl_tihi_support_surfaces(placements, base_z, constraints)
                if not support_surfaces:
                    continue
                best_fit = _mpl_pick_best_layer_placement(
                    [],
                    support_surfaces,
                    group["dimensions"],
                    constraints,
                    level_index % 2 == 1,
                    float(group.get("unit_weight") or 0.0),
                    placements,
                    base_z,
                )
                if best_fit is None:
                    continue
                placement = best_fit["placement"]
                if base_z + float(placement["case_height"]) > constraints["max_height_in"] + 0.001:
                    continue
                layer_capacity = _mpl_tihi_layer_capacity(group, constraints)
                layer_case_count = min(int(group.get("remaining_cases") or 0), layer_capacity)
                score = (
                    -float(base_z),
                    float(group.get("unit_weight") or 0.0),
                    1.0 if int(group.get("remaining_cases") or 0) >= layer_capacity else 0.0,
                    float(layer_case_count),
                    float(placement["case_length"]) * float(placement["case_width"]),
                    *tuple(best_fit.get("score") or ()),
                )
                if candidate is None or _mpl_score_gt(score, candidate["score"]):
                    candidate = {
                        "group": group,
                        "best_fit": best_fit,
                        "score": score,
                        "base_z": base_z,
                    }

        if candidate is None:
            for group in active_groups:
                overflow_count += max(0, int(group.get("remaining_cases") or 0))
                group["remaining_cases"] = 0
            break

        group = candidate["group"]
        best_fit = candidate["best_fit"]
        oriented = best_fit["placement"]
        base_z = float(candidate["base_z"])

        placed = {
            "x": oriented["x"],
            "y": oriented["y"],
            "z": base_z,
            "layer_index": 0,
            "case_length": oriented["case_length"],
            "case_width": oriented["case_width"],
            "case_height": oriented["case_height"],
            "rotated": bool(oriented.get("rotated")),
            "unit_weight": group.get("unit_weight") or 0.0,
            "label": group.get("label") or "",
            "color": group["color"],
            "support_ratio": float(best_fit.get("support_ratio") or 1.0),
        }
        placements.append(placed)

        group["remaining_cases"] = max(0, int(group["remaining_cases"]) - 1)

    _mpl_finalize_height_zone_patterns(placements, constraints)

    case_volume = sum(
        float(p.get("case_length") or 0.0)
        * float(p.get("case_width") or 0.0)
        * float(p.get("case_height") or 0.0)
        for p in placements
    )
    pallet_volume = constraints["max_length_in"] * constraints["max_width_in"] * constraints["max_height_in"]
    pallet_fill_pct = min(100.0, (case_volume / pallet_volume) * 100.0) if pallet_volume > 0 else 0.0
    return {
        "placements": placements,
        "used_height": max((_mpl_tihi_top_z(placement) for placement in placements), default=0.0),
        "overflow_count": overflow_count,
        "pallet_fill_pct": pallet_fill_pct,
    }


def _mpl_build_tihi_entries(
    mpl: Dict[str, Any],
    items: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    grouped: Dict[Tuple[str, str, str, str, str, str], Dict[str, Any]] = {}
    warnings: List[str] = []
    constraints = _mpl_tihi_constraints(mpl)

    for index, item in enumerate(items):
        pallet = _mpl_pallet_value(item)
        qty = _mpl_tihi_case_qty(item)
        if qty < 1:
            continue

        label = _mpl_tihi_item_label(item)
        length = _parse_float(item.get("length_in"))
        width = _parse_float(item.get("width_in"))
        height = _parse_float(item.get("height_in"))
        weight_raw = _mpl_clean(item.get("unit_weight_lbs"))
        dimensions = (length, width, height) if all(value is not None and value > 0 for value in (length, width, height)) else None
        unit_weight = _parse_float(weight_raw)

        if dimensions is None:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)} / {label}: missing Case dimensions in product master."
            )
            continue
        if unit_weight is None or unit_weight <= 0:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)} / {label}: missing Case weight in product master."
            )
            continue

        group_key = (
            pallet,
            _canonical_id(item.get("sku") or item.get("item_number") or item.get("gtin") or item.get("case_upc") or item.get("upc"))
            or _normalize(item.get("description") or "")
            or f"line-{_mpl_clean(item.get('line')) or '0'}",
            _format_number(length),
            _format_number(width),
            _format_number(height),
            weight_raw,
        )
        group = grouped.setdefault(group_key, {
            "pallet": pallet,
            "sku": _mpl_clean(item.get("sku")),
            "item_number": _mpl_clean(item.get("item_number")),
            "gtin": _mpl_clean(item.get("gtin") or item.get("case_upc") or item.get("upc")),
            "description": _mpl_clean(item.get("description")),
            "length_in": _format_number(length),
            "width_in": _format_number(width),
            "height_in": _format_number(height),
            "dimensions_in": " x ".join((_format_number(length), _format_number(width), _format_number(height))),
            "unit_weight_lbs": weight_raw,
            "dimensions": dimensions,
            "unit_weight": unit_weight,
            "assigned_cases": 0,
            "lines": [],
            "sort_index": index,
        })
        group["assigned_cases"] += qty
        if item.get("line") is not None:
            group["lines"].append(str(item.get("line")))

    pallet_groups: Dict[str, List[Dict[str, Any]]] = {}
    color_by_sku: Dict[str, Tuple[float, float, float]] = {}
    for group_index, group in enumerate(sorted(grouped.values(), key=lambda row: (_mpl_pallet_sort_key(row["pallet"]), row["sort_index"]))):
        label = group["sku"] or group["item_number"] or group["gtin"] or group["description"] or f"Item {group_index + 1}"
        group_constraints = _mpl_tihi_constraints(mpl, group["pallet"])
        orientation = _mpl_best_tihi_orientation(group["dimensions"], group_constraints)
        if orientation is None:
            warnings.append(
                f"Pallet {_mpl_pallet_label(group['pallet'])} / {label}: Case footprint exceeds the pallet base."
            )
            continue
        group["label"] = label
        color_key = _mpl_tihi_color_key({**group, "label": label}) or f"group-{group_index}"
        if color_key not in color_by_sku:
            color_by_sku[color_key] = _mpl_tihi_color(len(color_by_sku))
        group["color"] = color_by_sku[color_key]
        group["base_orientation"] = orientation
        group["lines"] = sorted(set(group["lines"]), key=lambda value: int(re.search(r"\d+", value).group(0)) if re.search(r"\d+", value) else value)
        pallet_groups.setdefault(group["pallet"], []).append(group)

    entries: List[Dict[str, Any]] = []
    for pallet, groups in sorted(pallet_groups.items(), key=lambda pair: _mpl_pallet_sort_key(pair[0])):
        pallet_constraints = _mpl_tihi_constraints(mpl, pallet)
        total_weight = sum(group["unit_weight"] * group["assigned_cases"] for group in groups)
        gross_weight = _mpl_round_product_weight_for_pallet(total_weight) + _MPL_PALLET_TARE_LBS
        if gross_weight > pallet_constraints["max_gross_lbs"]:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: gross pallet weight {int(round(gross_weight))} lbs exceeds the {pallet_constraints['max_gross_lbs']:.0f} lb limit."
            )

        groups = sorted(groups, key=lambda group: (-float(group.get("unit_weight") or 0.0), int(group.get("sort_index") or 0)))
        layout = _mpl_build_pallet_tihi_layout(groups, pallet_constraints)
        placements = layout["placements"]
        if not placements:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: no TI-Hi layout could be created from the assigned case measurements."
            )
            continue

        layer_buckets: Dict[int, List[Dict[str, Any]]] = {}
        for placement in placements:
            layer_buckets.setdefault(int(placement["layer_index"]), []).append(placement)
        max_layer = max(layer_buckets.keys())
        display_layer = max_layer
        top_placements = _mpl_visible_top_placements(placements)
        top_rows_used = len({(round(float(p["y"]), 4), round(float(p["case_width"]), 4)) for p in top_placements}) or 1
        max_cases_in_layer = max((len(layer) for layer in layer_buckets.values()), default=0)
        layer_patterns, layer_pattern_rows = _mpl_build_tihi_layer_patterns(placements)
        overflow_count = int(layout["overflow_count"])
        if overflow_count:
            warnings.append(
                f"Pallet {_mpl_pallet_label(pallet)}: {overflow_count} case(s) exceed the current pallet footprint/height constraints."
            )

        entries.append({
            "pallet": pallet,
            "pallet_label": _mpl_pallet_label(pallet),
            "constraints": pallet_constraints,
            "placements": placements,
            "top_placements": top_placements,
            "layer_patterns": layer_patterns,
            "layer_pattern_rows": layer_pattern_rows,
            "groups": groups,
            "assigned_cases": sum(group["assigned_cases"] for group in groups),
            "shown_cases": len(placements),
            "overflow_cases": overflow_count,
            "ti": max_cases_in_layer,
            "hi": max_layer + 1,
            "display_layer": display_layer,
            "top_rows_used": top_rows_used,
            "top_layer_cases": len(top_placements),
            "gross_weight_lbs": gross_weight,
            "pallet_fill_pct": float(layout.get("pallet_fill_pct") or 0.0),
            "used_height": float(layout["used_height"]),
            "lines": sorted({line for group in groups for line in group["lines"]}, key=lambda value: int(re.search(r"\d+", value).group(0)) if re.search(r"\d+", value) else value),
        })

    unique_warnings = list(dict.fromkeys(warnings))
    return entries, unique_warnings


def _mpl_draw_tihi_top_view(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 8
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_width_in"])
    pallet_w = constraints["max_length_in"] * scale
    pallet_h = constraints["max_width_in"] * scale
    px = x + (w - pallet_w) / 2
    py = y + (h - pallet_h) / 2
    _draw_mpl_cell(c, px, py, pallet_w, pallet_h, (1, 1, 1), _MPL_GRID, 0.6)

    for placement in entry.get("top_placements", []):
        rx = px + float(placement["x"]) * scale
        ry = py + pallet_h - ((float(placement["y"]) + float(placement["case_width"])) * scale)
        _draw_mpl_cell(
            c,
            rx,
            ry,
            float(placement["case_length"]) * scale,
            float(placement["case_width"]) * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.35,
        )

    c.setFillColorRGB(*_COLOR_LABEL)
    c.setFont("Helvetica", 5.0)
    c.drawCentredString(px + pallet_w / 2, py - 7, f"{int(round(constraints['max_length_in']))} in")
    c.saveState()
    c.translate(px - 8, py + pallet_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, f"{int(round(constraints['max_width_in']))} in")
    c.restoreState()
    c.setFillColorRGB(0, 0, 0)


def _mpl_draw_tihi_side_view(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 8
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_height_in"])
    pallet_w = constraints["max_length_in"] * scale
    stack_h = min(constraints["max_height_in"], float(entry.get("used_height") or 0.0)) * scale
    px = x + (w - pallet_w) / 2
    py = y + 8

    pallet_base_h = 8
    c.setFillColorRGB(0.68, 0.62, 0.47)
    c.setStrokeColorRGB(*_MPL_GRID)
    c.setLineWidth(0.5)
    c.rect(px, py, pallet_w, pallet_base_h, fill=1, stroke=1)
    notch_w = pallet_w / 4.5
    c.setFillColorRGB(1, 1, 1)
    c.rect(px + notch_w * 0.75, py + 2.0, notch_w * 0.8, pallet_base_h - 4.0, fill=1, stroke=0)
    c.rect(px + notch_w * 2.5, py + 2.0, notch_w * 0.8, pallet_base_h - 4.0, fill=1, stroke=0)

    for placement in entry.get("placements", []):
        rx = px + float(placement["x"]) * scale
        ry = py + pallet_base_h + float(placement["z"]) * scale
        _draw_mpl_cell(
            c,
            rx,
            ry,
            float(placement["case_length"]) * scale,
            float(placement["case_height"]) * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.35,
        )

    label_left_x = max(x + 5, px - 10)
    label_right_x = min(x + w - 5, px + pallet_w + 8)
    c.setFillColorRGB(0.86, 0.15, 0.15)
    c.setFont("Helvetica-Bold", 6.8)
    for index, row in enumerate(entry.get("layer_pattern_rows", [])):
        center_y = py + pallet_base_h + (float(row.get("z") or 0.0) + (float(row.get("height") or 0.0) / 2.0)) * scale
        label_x = label_left_x if index % 2 == 0 else label_right_x
        c.drawCentredString(label_x, center_y - 2.3, _mpl_clean(row.get("letter"))[:3])

    c.setFillColorRGB(*_COLOR_LABEL)
    c.setFont("Helvetica", 5.0)
    c.drawCentredString(px + pallet_w / 2, py - 7, f"{int(round(constraints['max_length_in']))} in")
    c.saveState()
    c.translate(px - 20, py + pallet_base_h + stack_h / 2)
    c.rotate(90)
    c.drawCentredString(0, 0, f"{int(round(float(entry.get('used_height') or 0.0)))} in")
    c.restoreState()
    c.setFillColorRGB(0, 0, 0)


def _mpl_draw_tihi_pattern_mini(
    c: canvas.Canvas,
    pattern: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    y: float,
    w: float,
    h: float,
) -> None:
    pad = 3
    scale = min((w - 2 * pad) / constraints["max_length_in"], (h - 2 * pad) / constraints["max_width_in"])
    pallet_w = constraints["max_length_in"] * scale
    pallet_h = constraints["max_width_in"] * scale
    px = x + (w - pallet_w) / 2
    py = y + (h - pallet_h) / 2
    _draw_mpl_cell(c, px, py, pallet_w, pallet_h, (1, 1, 1), _MPL_GRID, 0.35)

    for placement in pattern.get("placements") or []:
        case_length = float(placement.get("case_length") or placement.get("length") or 0.0)
        case_width = float(placement.get("case_width") or placement.get("width") or 0.0)
        rx = px + float(placement.get("x") or 0.0) * scale
        ry = py + pallet_h - ((float(placement.get("y") or 0.0) + case_width) * scale)
        _draw_mpl_cell(
            c,
            rx,
            ry,
            case_length * scale,
            case_width * scale,
            placement.get("color") or (0.92, 0.72, 0.39),
            _MPL_GRID,
            0.25,
        )


def _render_mpl_tihi_card(
    c: canvas.Canvas,
    entry: Dict[str, Any],
    constraints: Dict[str, float],
    x: float,
    top_y: float,
    w: float,
    h: float,
) -> float:
    bottom_y = top_y - h
    _draw_mpl_cell(c, x, bottom_y, w, h, (1, 1, 1), _MPL_GRID, 0.55)

    header_h = 0.21 * inch
    _draw_mpl_cell(c, x, top_y - header_h, w, header_h, _MPL_BLACK, _MPL_BLACK, 0.4)
    c.setFillColorRGB(1, 1, 1)
    c.setFont("Helvetica-Bold", 6.9)
    title = f"Pallet {entry['pallet_label']} • Current edited layout"
    c.drawString(x + 6, top_y - header_h / 2 - 2.2, title[:108])
    c.setFillColorRGB(0, 0, 0)

    info_top = top_y - header_h - 7
    c.setFont("Helvetica-Bold", 6.0)
    c.drawString(x + 6, info_top, f"{len(entry.get('groups') or [])} item group(s) on this pallet"[:126])
    c.setFont("Helvetica", 5.5)
    info_rows = [
        f"Assigned: {entry['assigned_cases']} case(s)   Shown: {entry['shown_cases']}   Gross pallet weight: {int(round(entry['gross_weight_lbs']))} lbs",
        f"TI x HI: {entry['ti']} x {entry['hi']}   Visible top surfaces: {entry['top_layer_cases']} case(s)   Used pallet volume: {entry['pallet_fill_pct']:.1f}%",
        f"Used stack height: {int(round(float(entry.get('used_height') or 0.0)))} in",
        f"Constraints: {int(round(constraints['max_length_in']))} x {int(round(constraints['max_width_in']))} x {int(round(constraints['max_height_in']))} in   Max gross: {int(round(constraints['max_gross_lbs']))} lbs",
    ]
    if entry.get("overflow_cases"):
        info_rows.append(f"Constraint warning: {entry['overflow_cases']} case(s) exceed the current pallet limits.")
    if entry.get("lines"):
        info_rows.append(f"MPL lines: {', '.join(entry['lines'])}")
    ty = info_top - 8
    for row in info_rows[:5]:
        c.drawString(x + 6, ty, row[:145])
        ty -= 6.4

    diagram_top = ty - 1
    legend_h = 0.42 * inch
    diagram_h = max(1.55 * inch, bottom_y + 10 + legend_h - diagram_top)
    gap = 8
    panel_w = (w - gap - 12) / 2
    panel_h = diagram_h
    left_x = x + 6
    right_x = left_x + panel_w + gap

    c.setFont("Helvetica-Bold", 6.0)
    c.drawCentredString(left_x + panel_w / 2, diagram_top - 7, 'TOP VIEW')
    c.drawCentredString(right_x + panel_w / 2, diagram_top - 7, 'SIDE VIEW')
    _mpl_draw_tihi_top_view(c, entry, constraints, left_x, diagram_top - panel_h, panel_w, panel_h)
    _mpl_draw_tihi_side_view(c, entry, constraints, right_x, diagram_top - panel_h, panel_w, panel_h)

    patterns = entry.get("layer_patterns") or []
    if patterns:
        pattern_y = bottom_y + 42
        c.setFont("Helvetica-Bold", 5.4)
        c.setFillColorRGB(*_COLOR_LABEL)
        c.drawString(x + 6, pattern_y + 31, "LAYER PATTERNS")
        max_patterns = min(6, len(patterns))
        pattern_gap = 5
        pattern_w = (w - 12 - ((max_patterns - 1) * pattern_gap)) / max_patterns
        for idx, pattern in enumerate(patterns[:max_patterns]):
            px = x + 6 + idx * (pattern_w + pattern_gap)
            _draw_mpl_cell(c, px, pattern_y, pattern_w, 28, (0.98, 0.99, 1.0), _MPL_GRID, 0.3)
            c.setFont("Helvetica-Bold", 6.6)
            c.setFillColorRGB(0, 0, 0)
            c.drawCentredString(px + 7, pattern_y + 15, _mpl_clean(pattern.get("letter"))[:3])
            _mpl_draw_tihi_pattern_mini(c, pattern, constraints, px + 15, pattern_y + 4, min(34, pattern_w - 18), 18)
            c.setFont("Helvetica", 4.5)
            layers = ", ".join(str(layer) for layer in (pattern.get("layers") or []))
            c.drawRightString(px + pattern_w - 3, pattern_y + 4, f"L {layers}"[:18])

    groups = entry.get("groups") or []
    c.setFont("Helvetica", 5.0)
    legend_cols = 2
    legend_w = (w - 14) / legend_cols
    legend_y = bottom_y + 8
    for idx, group in enumerate(groups[:6]):
        col = idx % legend_cols
        row = idx // legend_cols
        lx = x + 6 + (col * legend_w)
        ly = legend_y + (row * 11)
        color = group.get("color") or (0.92, 0.72, 0.39)
        c.setFillColorRGB(*color)
        c.setStrokeColorRGB(*_MPL_GRID)
        c.rect(lx, ly, 7, 7, fill=1, stroke=1)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(lx + 10, ly + 1.5, f"{_mpl_clean(group.get('label'))[:24]} • L {', '.join(group.get('lines') or [])[:12]} • {group.get('assigned_cases', 0)} cs")

    return bottom_y


def _render_mpl_tihi_pages(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    items: List[Dict[str, Any]],
    progress_callback: Optional[Callable[[str], None]] = None,
) -> int:
    snapshot = _mpl_tihi_snapshot_payload(mpl)
    if snapshot is not None:
        entries = snapshot["entries"]
        warnings = snapshot["warnings"]
        constraints = snapshot["constraints"]
        sheet_reader = _mpl_snapshot_image_reader(snapshot.get("sheet_image_data_url", ""))
        if sheet_reader is not None:
            if progress_callback:
                progress_callback(f"Rendering {mpl.get('id', 'MPL')} TI-Hi layout summary image...")
            return 1 if _draw_mpl_snapshot_page(c, sheet_reader) else 0
    else:
        entries, warnings = _mpl_build_tihi_entries(mpl, items)
        constraints = _mpl_tihi_constraints(mpl)

    snapshot_images = []
    for entry in entries:
        reader = _mpl_snapshot_image_reader(entry.get("image_data_url", ""))
        if reader is None:
            snapshot_images = []
            break
        snapshot_images.append(reader)
    if snapshot_images:
        pages = 0
        for index, reader in enumerate(snapshot_images, start=1):
            if progress_callback:
                progress_callback(
                    f"Rendering {mpl.get('id', 'MPL')} TI-Hi image page {index}/{len(snapshot_images)}..."
                )
            if _draw_mpl_snapshot_page(c, reader):
                pages += 1
        return pages

    pages = 0
    entry_index = 0
    first_page = True

    while first_page or entry_index < len(entries) or (first_page and not entries):
        if progress_callback:
            progress_callback(
                f"Rendering {mpl.get('id', 'MPL')} TI-Hi page {pages + 1}..."
            )

        y = _MPL_INNER_TOP
        _draw_mpl_cell(c, _MPL_MARGIN, y - 0.20 * inch, _MPL_INNER_W, 0.20 * inch, _MPL_BLACK, _MPL_BLACK, 0.5)
        c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 8.0)
        c.drawCentredString(
            _MPL_MARGIN + _MPL_INNER_W / 2,
            y - 0.10 * inch - 2,
            f"TI-HI LAYOUT SUMMARY - {mpl.get('id', 'MPL')}",
        )
        c.setFillColorRGB(0, 0, 0)
        y -= 0.26 * inch

        c.setFont("Helvetica", 5.8)
        c.drawString(_MPL_MARGIN, y, f"PO: {_mpl_clean(mpl.get('customer_po_number')) or '-'}")
        c.drawRightString(
            _MPL_MARGIN + _MPL_INNER_W,
            y,
            f"Constraints: {constraints['max_length_in']:.0f} x {constraints['max_width_in']:.0f} x {constraints['max_height_in']:.0f} in, max {constraints['max_gross_lbs']:.0f} lbs gross",
        )
        y -= 0.11 * inch
        c.setFont("Helvetica", 5.6)
        c.drawString(_MPL_MARGIN, y, "All dimensions shown in inches.")
        y -= 0.12 * inch

        if first_page:
            warning_text = "; ".join(warnings[:6])
            if warning_text:
                y = _draw_warning_box(
                    c,
                    warning_text,
                    _MPL_MARGIN,
                    y,
                    _MPL_INNER_W,
                    font_size=5.6,
                    padding=3,
                ) - 0.08 * inch

        if not entries:
            c.setFont("Helvetica-Bold", 8.0)
            c.drawCentredString(
                _MPL_MARGIN + _MPL_INNER_W / 2,
                y - 0.8 * inch,
                "No TI-Hi diagram could be generated for this MPL.",
            )
            c.setFont("Helvetica", 6.0)
            c.drawCentredString(
                _MPL_MARGIN + _MPL_INNER_W / 2,
                y - 1.05 * inch,
                "Add Case dimensions and Case weight for the palletized SKU rows in the product master, then render again.",
            )
            c.showPage()
            pages += 1
            break

        card_h = 4.15 * inch
        card_gap = 0.10 * inch
        while entry_index < len(entries) and y - card_h >= _MPL_INNER_BOTTOM:
            entry_constraints = entries[entry_index].get("constraints") or constraints
            _render_mpl_tihi_card(c, entries[entry_index], entry_constraints, _MPL_MARGIN, y, _MPL_INNER_W, card_h)
            y -= card_h + card_gap
            entry_index += 1

        c.showPage()
        pages += 1
        first_page = False

    return pages


def render_kehe_master_packing_list_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Master Packing List pages from an edited draft."""
    apply_product_master_to_mpl_draft(draft, force=False)
    _validate_mpl_each_item_numbers(draft)
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

        template_id = _mpl_template_id(draft, mpl)
        theme = _mpl_template_theme(template_id)
        items = _mpl_prepare_items(mpl)
        total_items_all += len(items)
        units = _mpl_build_units(items, template_id)

        # A4 page with taller MPL rows. Keep pagination conservative so rows do not clip.
        pages_units = _mpl_paginate_units(
            units,
            available_h=(7.45 if theme["compact"] else 6.85) * inch,
        )
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
            y = _render_mpl_header(c, mpl_page, page_idx, total_mpl_pages, template_id)
            y = _render_mpl_table_header(c, y, template_id)

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
                        template_id,
                    )
                else:
                    bg = (1, 1, 1) if alt % 2 == 0 else theme["row_alt"]
                    y = _render_mpl_item_row(c, payload, y, height, bg, template_id)
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

        total_pages_all += _render_mpl_tihi_pages(
            c,
            mpl,
            items,
            progress_callback=progress_callback,
        )

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
            "note": f"Generated with {_mpl_template_theme(template_id)['title']} template",
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
