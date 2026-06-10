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

import fitz
from reportlab.graphics.barcode import code128
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas


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
    current_order: Optional[Order] = None
    current_pack: Optional[Pack] = None

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

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

            current_order = Order(po=po, store=store, ship_to=ship_to, ship_from=ship_from)
            orders.append(current_order)
            current_pack = None

        elif level == "P" and current_order is not None:
            man = hl.find("./SegmentRef[@ID='MAN']")
            sscc = _get_elem(man, "02") if man is not None else ""
            if not sscc:
                raise ValueError(f"Missing SSCC (MAN02) for PO {current_order.po}")

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
            current_pack = Pack(
                sscc=sscc,
                tracking=pack_tracking,
                po=current_order.po,
                store=current_order.store,
                ship_date=ship_date,
                ship_from=current_order.ship_from,
                ship_to=current_order.ship_to,
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
            current_order.packs.append(current_pack)
            packs_flat.append(current_pack)

        elif level == "I" and current_order is not None:
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
            item = Item(
                vendor_item=pairs.get("VN", "") or pairs.get("VC", "") or pairs.get("VP", "") or pairs.get("SK", ""),
                retailer_item=pairs.get("CB", "") or pairs.get("IN", "") or pairs.get("BP", "") or pairs.get("PI", ""),
                upc=pairs.get("UP", "") or pairs.get("UK", "") or pairs.get("UA", "") or pairs.get("EN", ""),
                description=_get_elem(pid, "05") if pid is not None else "",
                qty=qty,
                lot=_first_ref(refs, ("LT", "LO", "BT")) or (current_pack.lot if current_pack else ""),
                expiration_date=dates.get("036") or dates.get("361") or (current_pack.expiration_date if current_pack else ""),
                manufacture_date=dates.get("094") or dates.get("371") or dates.get("118") or dates.get("011") or "",
                plant=_first_ref(refs, ("PL", "MF", "SU")) or (current_pack.plant if current_pack else ""),
            )
            current_order.items.append(item)
            if current_pack is not None:
                current_pack.items.append(item)

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
