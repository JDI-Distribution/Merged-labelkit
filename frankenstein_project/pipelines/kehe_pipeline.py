"""
KeHE GS1-128 label pipeline
---------------------------
Generates 4 x 6 in KeHE SSCC-18 / GS1-128 pallet/carton labels directly
from EDI 856 ASN XML files. No shipping-label PDF matching is performed.
"""

from __future__ import annotations

import argparse
import io
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

import hashlib

import fitz
from reportlab.graphics.barcode import code128
from reportlab.lib.pagesizes import LETTER, landscape
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from pipelines.kehe_dc_directory import find_kehe_dc


UPS_RE = re.compile(r"(1Z[0-9A-Z]{16})")


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
    description: str = ""
    qty: int = 0
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
    value = (value or "").strip()
    if not value:
        return ""

    # Some XML exporters provide DTM02 as MM/DD/YYYY instead of raw EDI digits.
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

        # Prefer canonical EDI CCYYMMDD, but support MMDDYYYY when present.
        if 1900 <= first4 <= 2100:
            return f"{digits[4:6]}-{digits[6:8]}-{digits[0:4]}"
        if 1900 <= last4 <= 2100:
            return f"{digits[0:2]}-{digits[2:4]}-{digits[4:8]}"

        return value
    if len(digits) == 6:
        return f"{digits[2:4]}-{digits[4:6]}-20{digits[0:2]}"
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

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

        if level == "S":
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
                upc=pairs.get("UP", "") or pairs.get("UK", "") or pairs.get("UA", "") or pairs.get("EN", ""),
                description=_get_elem(pid, "05") if pid is not None else "",
                qty=qty,
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


def _draw_code128_centered(c: canvas.Canvas, value: str, x0: float, x1: float, y: float, height: float, max_width: float) -> None:
    bar_width = 0.0125 * inch
    barcode = code128.Code128(value, barHeight=height, barWidth=bar_width, humanReadable=False)
    while barcode.width > max_width and bar_width > 0.0065 * inch:
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

    gx0 = 0.12 * inch
    gx1 = W - 0.12 * inch
    gy0 = 0.12 * inch
    gy1 = H - 0.20 * inch
    mid = (gx0 + gx1) / 2

    c.setFillColorRGB(0, 0, 0)
    c.setStrokeColorRGB(0, 0, 0)

    c.setFont("Helvetica-Bold", 7.5)
    c.drawRightString(gx1, H - 0.10 * inch, "KeHE")

    # Row guides, top to bottom, tuned to match the KeHE example zones A-I.
    y_top = gy1
    y_ab = y_top - 0.86 * inch
    y_cd = y_ab - 0.98 * inch
    y_ef = y_cd - 0.88 * inch
    y_gh = y_ef - 0.78 * inch
    y_i = gy0

    c.setLineWidth(0.7)
    c.rect(gx0, gy0, gx1 - gx0, gy1 - gy0)
    for y in [y_ab, y_cd, y_ef, y_gh]:
        c.line(gx0, y, gx1, y)
    c.line(mid, y_cd, mid, y_top)

    pad = 0.08 * inch
    left_x = gx0 + pad
    right_x = mid + pad
    left_w = mid - gx0 - 2 * pad
    right_w = gx1 - mid - 2 * pad

    # Zone A: Ship from.
    sf = pack.ship_from
    y = y_top - 0.12 * inch
    _draw_label(c, left_x, y, "Ship From:", 7.4)
    y -= 0.12 * inch
    _draw_value_lines(
        c,
        [sf.name, sf.line1, sf.line2, f"{sf.city}, {sf.state} {sf.zip}".strip(", "), sf.country],
        left_x,
        y,
        left_w,
        size=7.1,
        leading=7.8,
        max_lines=5,
    )

    # Zone B: Ship to.
    st = pack.ship_to
    ship_to_name = st.name
    if pack.store and pack.store not in ship_to_name:
        ship_to_name = f"{ship_to_name} #{pack.store}".strip()
    y = y_top - 0.12 * inch
    _draw_label(c, right_x, y, "Ship To:", 7.4)
    y -= 0.12 * inch
    _draw_value_lines(
        c,
        [ship_to_name, st.line1, st.line2, f"{st.city}, {st.state} {st.zip}".strip(", "), st.country],
        right_x,
        y,
        right_w,
        size=7.1,
        leading=7.8,
        max_lines=5,
    )

    # Zone C: Ship-to postal code and barcode.
    zip_ai = _zip_for_ai420(st.zip)
    y = y_ab - 0.19 * inch
    c.setFont("Helvetica", 7.6)
    c.drawString(left_x, y, "(420) Ship To Postal Code")
    if zip_ai:
        _draw_code128_centered(
            c,
            "\xf1" + "420" + zip_ai,
            gx0 + 0.12 * inch,
            mid - 0.12 * inch,
            y_cd + 0.29 * inch,
            0.42 * inch,
            mid - gx0 - 0.24 * inch,
        )
        c.setFont("Helvetica", 7.0)
        c.drawCentredString((gx0 + mid) / 2, y_cd + 0.18 * inch, f"(420) {zip_ai}")

    # Zone D: Carrier information.
    y = y_ab - 0.12 * inch
    _draw_label(c, right_x, y, "Carrier:", 7.6)
    c.setFont("Helvetica", 7.4)
    carrier = pack.carrier_name or pack.scac
    if carrier:
        c.drawString(right_x + 0.53 * inch, y, carrier[:24])
    y -= 0.13 * inch
    _draw_label(c, right_x, y, "B/L:", 7.6)
    if pack.bol:
        c.setFont("Helvetica", 7.4)
        c.drawString(right_x + 0.36 * inch, y, pack.bol[:27])
    y -= 0.13 * inch
    _draw_label(c, right_x, y, "Pro:", 7.6)
    if pack.pro:
        c.setFont("Helvetica", 7.1)
        c.drawString(right_x + 0.38 * inch, y, pack.pro[:27])
    y -= 0.23 * inch
    _draw_label(c, right_x, y, "Number of Cartons:", 7.6)
    y -= 0.13 * inch
    c.setFont("Helvetica", 7.4)
    c.drawString(right_x, y, f"{pack.carton_index} of {pack.total_cartons}")

    # Zones E/F: customer/retailer content information.
    summary = _pack_content_summary(pack)
    y = y_cd - 0.11 * inch
    for label, value in [
        ("Contents:", summary["contents"]),
        ("PO #:", pack.po),
        ("Item #:", summary["item"]),
        ("Item Desc:", summary["desc"]),
    ]:
        _draw_label(c, left_x, y, label, 7.4)
        if value:
            c.setFont("Helvetica", 7.3)
            c.drawString(left_x + 0.63 * inch, y, wrap_text(value, "Helvetica", 7.3, gx1 - (left_x + 0.68 * inch) - pad, 1)[0])
        y -= 0.12 * inch
    y -= 0.06 * inch
    _draw_label(c, left_x, y, "Carton Qty:", 7.4)
    c.setFont("Helvetica", 7.4)
    c.drawString(left_x + 0.63 * inch, y, summary["qty"] or "")

    # Zones G/H: lot and traceability information.
    y = y_ef - 0.20 * inch
    for label, value in [
        ("Lot #:", summary["lot"]),
        ("Expiration Date:", summary["expiration"]),
        ("Manufacture Date:", summary["manufacture"]),
        ("Manufacturing Plant #:", summary["plant"]),
    ]:
        _draw_label(c, left_x, y, label, 7.5)
        if value:
            c.setFont("Helvetica", 7.4)
            c.drawString(left_x + 1.15 * inch, y, value[:36])
        y -= 0.13 * inch

    # Zone I: SSCC barcode and human-readable text.
    sscc18 = normalize_sscc(pack.sscc)
    c.setFont("Helvetica", 7.6)
    c.drawCentredString(W / 2, y_gh - 0.22 * inch, "Serialized Shipping Container Number")
    if sscc18:
        _draw_code128_centered(
            c,
            "\xf1" + "00" + sscc18,
            gx0 + 0.12 * inch,
            gx1 - 0.12 * inch,
            gy0 + 0.40 * inch,
            0.75 * inch,
            gx1 - gx0 - 0.24 * inch,
        )
        c.setFont("Helvetica", 7.2)
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
        "carton_count": "",
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
            # TD1: carton count, weight, cube
            for td1 in _segment_refs(hl, "TD1"):
                if not header["carton_count"]:
                    header["carton_count"] = _get_elem(td1, "02")
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


def build_kehe_pallet_label_draft(xml_paths: List[str]) -> Dict[str, Any]:
    """Parse XML files and return an editable pallet label draft."""
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

    pallets = []
    needs_review_count = 0

    for idx, ship in enumerate(shipments, start=1):
        header = ship["header"]
        dc_info = ship["dc_info"]
        packs = ship["packs"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        pallet_warnings: List[str] = list(header.get("warnings", []))
        pallet_warnings.append(
            "Pallet count was not explicitly provided in XML. Defaulted to 1."
        )

        ship_from = _ship_from_str(header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)

        pallets.append({
            "id": f"PALLET-{idx}",
            "status": "Needs Review" if needs_review else "Ready",
            "dc": dc_info["dc"] if dc_info else "Unknown",
            "title": "PALLET PLACARD",
            "date": header.get("ship_date", ""),
            "ship_from": ship_from,
            "ship_to": ship_to,
            "billing": billing,
            "customer_po_numbers": header.get("customer_po_number", ""),
            "bol_number": header.get("bol_number", ""),
            "pro_number": header.get("pro_number", ""),
            "carrier": header.get("carrier", ""),
            "pallet_number": "1",
            "total_pallets": "1",
            "carton_count": header.get("carton_count", ""),
            "placement_note": (
                "Place one placard on the front and one placard on the back of the pallet."
            ),
            "copies": 2,
            "source_files": [header["source_file"]],
            "warnings": pallet_warnings,
        })

    return {
        "document_type": "kehe_pallet_label",
        "version": 1,
        "summary": {
            "xml_files": len(xml_paths),
            "groups": len(pallets),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "pallets": pallets,
    }


def build_kehe_master_packing_list_draft(xml_paths: List[str]) -> Dict[str, Any]:
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
        orders = ship["orders"]
        needs_review = ship["needs_review"]

        if needs_review:
            needs_review_count += 1

        mpl_warnings: List[str] = list(header.get("warnings", []))
        mpl_warnings.append(
            "Pallet count was not explicitly provided in XML. Defaulted to 1."
        )

        ship_from = _ship_from_str(header, packs)
        ship_to = _ship_to_str(dc_info, header.get("xml_ship_to", {}))
        billing = _billing_str(dc_info)

        # Build item rows from all packs
        items = []
        item_line = 1
        seen_item_keys: set = set()
        for pack in packs:
            for item in pack.items:
                item_key = (
                    item.upc or item.vendor_item or item.retailer_item,
                    item.lot,
                    pack.po,
                )
                if item_key in seen_item_keys:
                    continue
                seen_item_keys.add(item_key)
                item_warnings = []
                if not item.upc:
                    item_warnings.append(f"Line {item_line}: missing item UPC")
                if not item.qty:
                    item_warnings.append(f"Line {item_line}: missing quantity")
                if not item.lot:
                    item_warnings.append(f"Line {item_line}: missing lot number")
                if not item.expiration_date:
                    item_warnings.append(f"Line {item_line}: missing expiration date")
                mpl_warnings.extend(item_warnings)

                # case UPC: try to build 14-digit version or use available field
                case_upc = ""
                if item.upc and len(re.sub(r"\D", "", item.upc)) in (12, 13):
                    digits = re.sub(r"\D", "", item.upc)
                    case_upc = "2" + digits.zfill(13)
                elif item.retailer_item and len(re.sub(r"\D", "", item.retailer_item)) >= 12:
                    case_upc = item.retailer_item

                # pallet_weight: distribute total shipment weight proportionally by qty
                pallet_weight_str = ""
                total_weight_raw = header.get("total_weight", "")
                carton_count_raw = header.get("carton_count", "")
                if total_weight_raw and item.qty:
                    # Extract numeric weight value and unit (e.g. "102 LB" → 102, "LB")
                    m_tw = re.match(r"([\d.]+)\s*([A-Za-z]*)", total_weight_raw.strip())
                    m_cc = re.match(r"(\d+)", carton_count_raw.strip()) if carton_count_raw else None
                    if m_tw:
                        try:
                            total_wt = float(m_tw.group(1))
                            wt_unit = m_tw.group(2).upper() or "LB"
                            divisor = int(m_cc.group(1)) if m_cc and int(m_cc.group(1)) > 0 else len(items) + 1
                            # Distribute evenly across cartons; multiply by item qty ratio
                            per_carton = total_wt / divisor
                            item_wt = round(per_carton * item.qty, 2)
                            pallet_weight_str = f"{item_wt} {wt_unit}"
                        except (ValueError, ZeroDivisionError):
                            pallet_weight_str = ""

                items.append({
                    "line": item_line,
                    "location_on_pallet": "",
                    "item_number": item.vendor_item or item.retailer_item or item.upc,
                    "upc": item.upc or item.retailer_item or item.vendor_item,
                    "case_upc": case_upc,
                    "description": item.description,
                    "lot": item.lot,
                    "expiration_date": item.expiration_date,
                    "uom": "CASES",
                    "qty_on_pallet": str(item.qty) if item.qty else "",
                    "total_ordered": str(item.qty) if item.qty else "",
                    "total_shipped": str(item.qty) if item.qty else "",
                    "pallet_weight": pallet_weight_str,
                    "notes": "",
                })
                item_line += 1

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
            "pro_number": header.get("pro_number", ""),
            "order_no": header.get("order_no", ""),
            "po_date": header.get("po_date", ""),
            "page_no": "1",
            "total_weight": header.get("total_weight", ""),
            "ship_via": header.get("carrier", ""),
            "total_pallets": "1",
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

    return {
        "document_type": "kehe_master_packing_list",
        "version": 1,
        "summary": {
            "xml_files": len(xml_paths),
            "packing_lists": len(packing_lists),
            "needs_review": needs_review_count,
            "duplicate_files_skipped": len(duplicate_files),
        },
        "warnings": global_warnings,
        "packing_lists": packing_lists,
    }


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

    Layout (top-to-bottom):
      1. PALLET PLACECARD title   -- black bg, white bold 12pt centred
      2. DATE row                 -- gray label | white value
      3. SHIP FROM row            -- gray label | white value (multiline)
      4. SHIP TO row              -- gray label | white value (multiline)
      5. PALLET # row             -- 5 segments with green-tinted number cells
      6. KEHE PO#S header row     -- dark bg, white bold 8pt centred
      7. PO# value row            -- gray label | white value
      8. (optional) needs-review warning at very bottom
    """
    W, H = 4 * inch, 6 * inch
    margin = 0.18 * inch
    inner_w = W - 2 * margin
    inner_h = H - 2 * margin
    x0 = margin
    y0 = margin
    y1 = y0 + inner_h

    needs_review = pallet.get("status") == "Needs Review"

    # row height constants
    title_h  = 0.32 * inch
    date_h   = 0.28 * inch
    from_h   = 1.20 * inch
    to_h     = 1.20 * inch
    pallet_h = 0.35 * inch
    po_hdr_h = 0.28 * inch
    warn_h   = 0.32 * inch if needs_review else 0.0
    po_val_h = max(
        0.26 * inch,
        inner_h - title_h - date_h - from_h - to_h - pallet_h - po_hdr_h - warn_h,
    )

    # y positions of the BOTTOM edge of each row (rows drawn top-down)
    title_bot  = y1 - title_h
    date_bot   = title_bot  - date_h
    from_bot   = date_bot   - from_h
    to_bot     = from_bot   - to_h
    pallet_bot = to_bot     - pallet_h
    po_hdr_bot = pallet_bot - po_hdr_h
    po_val_bot = po_hdr_bot - po_val_h

    label_w = inner_w * 0.35
    value_x = x0 + label_w
    value_w = inner_w - label_w
    pad     = 0.07 * inch

    # outer border (1 pt black)
    c.setStrokeColorRGB(0, 0, 0)
    c.setLineWidth(1.0)
    c.rect(x0, y0, inner_w, inner_h)

    def _two_col(row_bot: float, row_h: float, label_text: str, value_text: str) -> None:
        """Draw a 2-column (gray label | white value) row."""
        _draw_rect_with_fill(c, x0,     row_bot, label_w, row_h,
                             (0.93, 0.93, 0.93), _COLOR_BORDER, 0.5)
        _draw_rect_with_fill(c, value_x, row_bot, value_w, row_h,
                             (1.0, 1.0, 1.0),   _COLOR_BORDER, 0.5)
        c.setFont("Helvetica-Bold", 8)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(x0 + pad, row_bot + row_h / 2 - 3.5, label_text)
        c.setFont("Helvetica", 8)
        lines = wrap_text(value_text or "", "Helvetica", 8,
                          value_w - 2 * pad, max_lines=8)
        leading  = 9.5
        total_th = len(lines) * leading
        if total_th < row_h - 2 * pad:
            ty = row_bot + row_h / 2 + total_th / 2 - leading * 0.75
        else:
            ty = row_bot + row_h - pad - leading * 0.75
        for line in lines:
            if ty < row_bot + 1:
                break
            c.drawString(value_x + pad, ty, line)
            ty -= leading
        c.setFillColorRGB(0, 0, 0)

    # 1. Title row
    _draw_rect_with_fill(c, x0, title_bot, inner_w, title_h,
                         (0, 0, 0), (0, 0, 0), 1.0)
    c.setFont("Helvetica-Bold", 12)
    c.setFillColorRGB(1, 1, 1)
    title_text = pallet.get("title") or "PALLET PLACECARD"
    c.drawCentredString(x0 + inner_w / 2,
                        title_bot + title_h / 2 - 4.5, title_text)

    # 2. DATE row
    date_val = (pallet.get("expected_delivery_date")
                or pallet.get("date", ""))
    _two_col(date_bot, date_h, "DATE:", date_val)

    # 3. SHIP FROM row
    _two_col(from_bot, from_h, "SHIP FROM:", pallet.get("ship_from", ""))

    # 4. SHIP TO row
    _two_col(to_bot, to_h, "SHIP TO:", pallet.get("ship_to", ""))

    # 5. PALLET # row (5 segments)
    seg_pcts  = [0.30, 0.20, 0.15, 0.20, 0.15]
    seg_fills = [
        (0.93, 0.93, 0.93),  # "PALLET #" label
        (0.80, 1.00, 0.80),  # pallet number
        (0.93, 0.93, 0.93),  # "OF"
        (0.80, 1.00, 0.80),  # total pallets
        (0.93, 0.93, 0.93),  # "TOTAL"
    ]
    seg_texts = [
        "PALLET #",
        str(pallet.get("pallet_number", "1")),
        "OF",
        str(pallet.get("total_pallets", "1")),
        "TOTAL",
    ]
    seg_bold  = [True, False, True, False, True]
    seg_sizes = [8, 12, 8, 12, 8]
    cx = x0
    for pct, fill, text, bold, sz in zip(seg_pcts, seg_fills, seg_texts,
                                         seg_bold, seg_sizes):
        sw = inner_w * pct
        _draw_rect_with_fill(c, cx, pallet_bot, sw, pallet_h,
                             fill, _COLOR_BORDER, 0.5)
        c.setFont("Helvetica-Bold" if bold else "Helvetica", sz)
        c.setFillColorRGB(0, 0, 0)
        c.drawCentredString(cx + sw / 2,
                            pallet_bot + pallet_h / 2 - sz * 0.35, text)
        cx += sw

    # 6. "KEHE PO#S ON THIS PALLET:" header row
    _draw_rect_with_fill(c, x0, po_hdr_bot, inner_w, po_hdr_h,
                         (0.2, 0.2, 0.2), _COLOR_BORDER, 0.5)
    c.setFont("Helvetica-Bold", 8)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(x0 + inner_w / 2,
                        po_hdr_bot + po_hdr_h / 2 - 3.5,
                        "KEHE PO#S ON THIS PALLET:")

    # 7. PO# value row
    _two_col(po_val_bot, po_val_h, "PO#:", pallet.get("customer_po_numbers", ""))

    # 8. Needs-review warning at the very bottom
    if needs_review and warn_h > 0:
        _draw_warning_box(
            c,
            "NEEDS REVIEW — Unknown KeHE DC. Verify Ship-To before printing.",
            x0 + 0.03 * inch,
            po_val_bot,           # top of warning area = bottom of PO# row
            inner_w - 0.06 * inch,
            font_size=6,
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
# Master Packing List renderer
# ===========================================================================

_MPL_PAGE_W, _MPL_PAGE_H = LETTER          # 8.5 x 11 in
_MPL_MARGIN = 0.4 * inch
_MPL_INNER_W = _MPL_PAGE_W - 2 * _MPL_MARGIN
_MPL_INNER_TOP = _MPL_PAGE_H - _MPL_MARGIN
_MPL_INNER_BOTTOM = _MPL_MARGIN

# Column definitions: (key, header label, relative_width)
_ITEM_COLUMNS: List[Tuple[str, str, float]] = [
    ("location_on_pallet", "Location on\nPallet",          0.10),
    ("item_number",        "Item Number",                   0.15),
    ("_description_block", "Pallet Weight &\nItem Description", 0.35),
    ("uom",                "UOM",                           0.08),
    ("qty_on_pallet",      "Qty On\nPallet",               0.10),
    ("total_ordered",      "Total\nOrdered",               0.11),
    ("total_shipped",      "Total\nShipped",               0.11),
]

def _render_mpl_header(
    c: canvas.Canvas,
    mpl: Dict[str, Any],
    page_num: int,
    total_pages: int,
) -> float:
    """Draw MPL header block; return the y position below the header."""
    x0      = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    pad     = 0.08 * inch

    needs_review = mpl.get("status") == "Needs Review"

    # ── Title bar ──────────────────────────────────────────────────────────
    y = _MPL_INNER_TOP
    title_h = 0.35 * inch
    _draw_rect_with_fill(c, x0, y - title_h, inner_w, title_h,
                         (0.1, 0.1, 0.1), _COLOR_BORDER)
    c.setFont("Helvetica-Bold", 13)
    c.setFillColorRGB(1, 1, 1)
    c.drawCentredString(x0 + inner_w / 2, y - title_h + 0.11 * inch,
                        mpl.get("title") or "MASTER PACKING LIST")
    y -= title_h

    # ── Needs Review banner ────────────────────────────────────────────────
    if needs_review:
        y = _draw_warning_box(
            c,
            "NEEDS REVIEW — Unknown KeHE DC. Verify addresses before using.",
            x0 + 0.02 * inch, y,
            inner_w - 0.04 * inch,
            font_size=7.5, padding=4,
        )

    # ── Info table (3 rows x variable cols) ───────────────────────────────
    # Row 1: Customer PO Number (50%) | Pro No (50%)
    # Row 2: Order No (1/3) | Date (1/3) | Page No (1/3)
    # Row 3: Total Weight (50%) | Ship Via (25%) | Total Pallets (25%)
    info_row_h = 0.28 * inch
    info_rows = [
        [
            (0.50, "Customer PO Number", mpl.get("customer_po_number", "")),
            (0.50, "Pro No",             mpl.get("pro_number", "")),
        ],
        [
            (1/3,  "Order No",   mpl.get("order_no", "")),
            (1/3,  "Date",       mpl.get("po_date", "")),
            (1/3,  f"Page",      f"{page_num} of {total_pages}"),
        ],
        [
            (0.50, "Total Weight",  mpl.get("total_weight", "")),
            (0.25, "Ship Via",      mpl.get("ship_via", "")),
            (0.25, "Total Pallets", mpl.get("total_pallets", "")),
        ],
    ]
    for row_cells in info_rows:
        row_top = y
        cx = x0
        for rel_w, lbl, val in row_cells:
            cw = inner_w * rel_w
            _draw_rect_with_fill(c, cx, row_top - info_row_h, cw, info_row_h,
                                 _COLOR_HEADER_BG, _COLOR_BORDER, 0.4)
            c.setFont("Helvetica-Bold", 6.5)
            c.setFillColorRGB(*_COLOR_LABEL)
            c.drawString(cx + pad, row_top - pad, lbl)
            c.setFont("Helvetica", 8)
            c.setFillColorRGB(0, 0, 0)
            c.drawString(cx + pad, row_top - info_row_h + pad * 0.6, val)
            cx += cw
        y -= info_row_h

    # ── Address block: 3 columns (Supplier | Bill To | Ship To) ───────────
    addr_h  = 0.85 * inch
    col3_w  = inner_w / 3
    addr_labels = [
        ("SUPPLIER INFO:", mpl.get("supplier_info", "")),
        ("BILL TO:",       mpl.get("bill_to", "")),
        ("SHIP TO:",       mpl.get("ship_to", "")),
    ]
    addr_top = y
    for ci, (lbl, val) in enumerate(addr_labels):
        cx = x0 + ci * col3_w
        _draw_rect_with_fill(c, cx, addr_top - addr_h, col3_w, addr_h,
                             (1, 1, 1), _COLOR_BORDER, 0.4)
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColorRGB(*_COLOR_LABEL)
        c.drawString(cx + pad, addr_top - pad, lbl)
        c.setFont("Helvetica", 7.5)
        c.setFillColorRGB(0, 0, 0)
        lines = (val or "").split("\n")
        ty = addr_top - info_row_h * 0.85
        for ln in lines[:7]:
            wrapped = wrap_text(ln, "Helvetica", 7.5, col3_w - 2 * pad, max_lines=1)
            if wrapped:
                c.drawString(cx + pad, ty, wrapped[0])
            ty -= 9
    y = addr_top - addr_h

    # ── Dates / instructions row (3 cols) ─────────────────────────────────
    dates_h = 0.28 * inch
    dates_top = y
    dates_cells = [
        ("Customer PO Num",      mpl.get("customer_po_number", "")),
        ("EST Ship Date",        mpl.get("est_ship_date", "")),
        ("Shipping Instructions", mpl.get("shipping_instructions", "")),
    ]
    for ci, (lbl, val) in enumerate(dates_cells):
        cx = x0 + ci * col3_w
        _draw_rect_with_fill(c, cx, dates_top - dates_h, col3_w, dates_h,
                             _COLOR_HEADER_BG, _COLOR_BORDER, 0.4)
        c.setFont("Helvetica-Bold", 6.5)
        c.setFillColorRGB(*_COLOR_LABEL)
        c.drawString(cx + pad, dates_top - pad, lbl)
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(0, 0, 0)
        c.drawString(cx + pad, dates_top - dates_h + pad * 0.6, val)
    y = dates_top - dates_h

    c.setStrokeColorRGB(0, 0, 0)
    c.setFillColorRGB(0, 0, 0)
    return y


def _render_mpl_table_header(c: canvas.Canvas, y: float) -> float:
    """Draw item table header row; return y below."""
    x0      = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    th      = 0.22 * inch

    _draw_rect_with_fill(c, x0, y - th, inner_w, th,
                         (0, 0, 0), _COLOR_BORDER)
    col_x = x0
    c.setFillColorRGB(1, 1, 1)
    for _, header_lbl, rel_w in _ITEM_COLUMNS:
        col_w = inner_w * rel_w
        lines = header_lbl.split("\n")
        line_h = 6
        ty = y - th + (th - len(lines) * line_h) / 2 + (len(lines) - 1) * line_h
        for ln in lines:
            c.setFont("Helvetica-Bold", 6)
            c.drawString(col_x + 2, ty, ln)
            ty -= line_h
        col_x += col_w
    c.setFillColorRGB(0, 0, 0)
    return y - th


def _render_mpl_item_row(c: canvas.Canvas, item: Dict[str, Any],
                         y: float, row_h: float,
                         bg_rgb: Tuple[float, float, float] = (1, 1, 1)) -> float:
    """Draw one item row; return y below."""
    x0      = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    col_x   = x0
    _draw_rect_with_fill(c, x0, y - row_h, inner_w, row_h,
                         bg_rgb, _COLOR_BORDER, 0.3)
    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0, 0, 0)
    for key, _, rel_w in _ITEM_COLUMNS:
        col_w = inner_w * rel_w
        if key == "_description_block":
            # Render: pallet_weight bold | description | EXP: italic
            ty = y - 0.05 * inch
            pw = str(item.get("pallet_weight") or "").strip()
            desc = str(item.get("description") or "").strip()
            exp  = str(item.get("expiration_date") or "").strip()
            if pw:
                c.setFont("Helvetica-Bold", 7)
                pww = wrap_text(pw, "Helvetica-Bold", 7, col_w - 4, max_lines=1)
                c.drawString(col_x + 2, ty, pww[0] if pww else "")
                ty -= 8
                c.setFont("Helvetica", 7)
            if desc:
                dlines = wrap_text(desc, "Helvetica", 7, col_w - 4, max_lines=4)
                for dl in dlines:
                    if ty < y - row_h + 2:
                        break
                    c.drawString(col_x + 2, ty, dl)
                    ty -= 8
            if exp:
                c.setFont("Helvetica-Oblique", 6.5)
                ew = wrap_text(f"EXP: {exp}", "Helvetica-Oblique", 6.5,
                               col_w - 4, max_lines=1)
                if ty >= y - row_h + 2:
                    c.drawString(col_x + 2, ty, ew[0] if ew else "")
                c.setFont("Helvetica", 7)
        else:
            val = str(item.get(key) or "")
            wrapped = wrap_text(val, "Helvetica", 7, col_w - 4, max_lines=1)
            c.drawString(col_x + 2, y - row_h + 0.05 * inch,
                         wrapped[0] if wrapped else "")
        col_x += col_w
    return y - row_h


def _render_mpl_pallet_group_row(c: canvas.Canvas, y: float, row_h: float,
                                  pallet_num: str, pallet_weight: str) -> float:
    """Draw a pallet-group separator row; return y below."""
    x0      = _MPL_MARGIN
    inner_w = _MPL_INNER_W
    _draw_rect_with_fill(c, x0, y - row_h, inner_w, row_h,
                         (0.85, 0.93, 1.0), _COLOR_BORDER, 0.4)
    c.setFont("Helvetica-Bold", 7.5)
    c.setFillColorRGB(0, 0, 0)
    label = f"Pallet: {pallet_num}"
    if pallet_weight:
        label += f"   {pallet_weight} LBS"
    c.drawString(x0 + 4, y - row_h + 0.05 * inch, label)
    return y - row_h


def render_kehe_master_packing_list_pdf(
    draft: Dict[str, Any],
    out_pdf: str,
    progress_callback: Optional[Callable[[str], None]] = None,
) -> Dict[str, Any]:
    """Render Master Packing List pages from an edited draft.

    Paginates item rows automatically across multiple pages when needed.
    Returns a report dict suitable for the frontend report panel.
    """
    packing_lists = draft.get("packing_lists") or []
    if not packing_lists:
        raise ValueError("Draft contains no packing lists to render.")

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)

    total_pages_all = 0
    total_items_all = 0
    rows = []
    needs_review_count = 0

    for mpl in packing_lists:
        status = mpl.get("status", "Ready")
        if not mpl.get("ship_to", "").strip():
            status = "Needs Review"
            mpl["status"] = status
        if not mpl.get("customer_po_number", "").strip():
            status = "Needs Review"
            mpl["status"] = status
        if status == "Needs Review":
            needs_review_count += 1

        try:
            total_pallets_val = str(int(str(mpl.get("total_pallets") or "1").strip() or "1"))
        except (ValueError, TypeError):
            total_pallets_val = "1"
        mpl["total_pallets"] = total_pallets_val

        items = mpl.get("items") or []
        total_items_all += len(items)

        if progress_callback:
            progress_callback(
                f"Rendering {mpl.get('id', 'MPL')} "
                f"({len(items)} item{'s' if len(items) != 1 else ''})…"
            )

        # Paginate items
        item_row_h = 0.165 * inch
        # Estimate how many items fit on first page vs continuation pages
        # First page header height approx 2.1 inches
        first_page_header_h = 2.1 * inch
        table_header_h = 0.18 * inch
        avail_first = (_MPL_INNER_TOP - _MPL_INNER_BOTTOM
                       - first_page_header_h - table_header_h)
        items_per_first = max(1, int(avail_first / item_row_h))

        # Continuation pages: only table header + footer
        cont_avail = (_MPL_INNER_TOP - _MPL_INNER_BOTTOM
                      - 0.28 * inch - table_header_h - 0.15 * inch)
        items_per_cont = max(1, int(cont_avail / item_row_h))

        # Split items into pages
        pages_items: List[List[Dict[str, Any]]] = []
        if items:
            pages_items.append(items[:items_per_first])
            remaining = items[items_per_first:]
            while remaining:
                pages_items.append(remaining[:items_per_cont])
                remaining = remaining[items_per_cont:]
        else:
            pages_items.append([])

        total_mpl_pages = len(pages_items)

        for page_idx, page_items in enumerate(pages_items, start=1):
            if progress_callback:
                progress_callback(
                    f"Rendering {mpl.get('id', 'MPL')} page {page_idx}/{total_mpl_pages}…"
                )

            mpl_page = dict(mpl)
            mpl_page["page_no"] = str(page_idx)

            y = _render_mpl_header(c, mpl_page, page_idx, total_mpl_pages)
            y = _render_mpl_table_header(c, y)

            prev_pallet = None
            for row_i, item in enumerate(page_items):
                # pallet group separator when location_on_pallet changes
                pallet_loc = str(item.get("location_on_pallet") or "").strip()
                if pallet_loc and pallet_loc != prev_pallet:
                    if y - item_row_h < _MPL_INNER_BOTTOM:
                        break
                    y = _render_mpl_pallet_group_row(
                        c, y, item_row_h,
                        pallet_loc,
                        str(item.get("pallet_weight") or ""),
                    )
                    prev_pallet = pallet_loc
                if y - item_row_h < _MPL_INNER_BOTTOM:
                    break  # safety
                bg = (1, 1, 1) if row_i % 2 == 0 else (0.97, 0.97, 0.97)
                y = _render_mpl_item_row(c, item, y, item_row_h, bg_rgb=bg)

            # Page outer border
            c.setStrokeColorRGB(0.2, 0.2, 0.2)
            c.setLineWidth(1.0)
            c.rect(
                _MPL_MARGIN,
                _MPL_INNER_BOTTOM,
                _MPL_INNER_W,
                _MPL_PAGE_H - 2 * _MPL_MARGIN,
            )

            # Warnings box at bottom of first page
            if page_idx == 1 and mpl.get("warnings"):
                warning_text = "; ".join(
                    w for w in mpl["warnings"]
                    if "defaulted to 1" not in w.lower()  # suppress routine pallet warning
                )
                if warning_text:
                    warn_y = _MPL_INNER_BOTTOM + 0.22 * inch
                    c.setFont("Helvetica-Oblique", 6)
                    c.setFillColorRGB(*_COLOR_LABEL)
                    wt_wrapped = wrap_text(warning_text, "Helvetica-Oblique", 6,
                                          _MPL_INNER_W - 0.1 * inch, max_lines=2)
                    for wline in wt_wrapped:
                        c.drawString(_MPL_MARGIN + 0.05 * inch, warn_y, wline)
                        warn_y += 8
                    c.setFillColorRGB(0, 0, 0)

            c.showPage()
            total_pages_all += 1

        total_mpl_pages = len(pages_items)

        ship_to_lines = (mpl.get("ship_to") or "").split("\n")
        ship_to_display = ship_to_lines[0] if ship_to_lines else "—"

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
