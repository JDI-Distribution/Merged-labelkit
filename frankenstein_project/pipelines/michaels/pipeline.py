"""
label_pipeline.py
-----------------
Full pipeline: XML ASN + UPS shipping label PDF → output PDF
(GS1 label + packing list per pack, with shipping label page prepended).

Works with image-based shipping PDFs (ShipStation / UPS) by using
Tesseract OCR to extract tracking numbers when no text layer is present.

Iteration order: shipping label pages drive the output.
  For each shipping label page (in order):
    1. OCR → extract tracking / PO / store
    2. Find matching XML pack  (tracking → PO → store)
    3. Emit: shipping page  →  GS1 label  →  packing list

Requirements:
    pip install PyPDF2 pymupdf reportlab pdf2image pytesseract pillow

    Tesseract OCR (Windows):
        https://github.com/UB-Mannheim/tesseract/wiki

    Poppler (Windows, required by pdf2image):
        https://github.com/oschwartz10612/poppler-windows/releases

Usage:
    python label_pipeline.py \
        --xml "my_asn.xml" \
        --shipping "Label (1).pdf" \
        --out "output.pdf"

    # Multiple XMLs combined:
    python label_pipeline.py \
        --xml "asn1.xml" "asn2.xml" \
        --shipping "Label .pdf" \
        --out "output.pdf"
"""

from __future__ import annotations

import argparse
import io
import re
import shutil
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

from PyPDF2 import PdfReader, PdfWriter
import fitz

from reportlab.pdfgen import canvas
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode import code128
from reportlab.pdfbase import pdfmetrics

# ── Tesseract path (Windows) ──────────────────────────────────────────────────
import os
import pytesseract


def _first_existing_path(candidates: List[Optional[str]]) -> Optional[str]:
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _resolve_tesseract_cmd() -> Optional[str]:
    if os.getenv("TESSERACT_CMD"):
        return os.getenv("TESSERACT_CMD")

    path_hit = shutil.which("tesseract")
    if path_hit:
        return path_hit

    local_app_data = os.getenv("LOCALAPPDATA", "")
    program_files = os.getenv("ProgramFiles", r"C:\Program Files")
    candidates = [
        os.path.join(local_app_data, "Programs", "Tesseract-OCR", "tesseract.exe"),
        os.path.join(program_files, "Tesseract-OCR", "tesseract.exe"),
    ]
    return _first_existing_path(candidates)


def _resolve_poppler_bin_dir() -> Optional[str]:
    for env_name in ("POPPLER_PATH", "POPPLER_BIN"):
        env_value = os.getenv(env_name)
        if env_value and os.path.exists(os.path.join(env_value, "pdfinfo.exe")):
            return env_value

    pdfinfo_path = shutil.which("pdfinfo")
    if pdfinfo_path:
        return os.path.dirname(pdfinfo_path)

    pdftoppm_path = shutil.which("pdftoppm")
    if pdftoppm_path:
        return os.path.dirname(pdftoppm_path)

    local_app_data = os.getenv("LOCALAPPDATA", "")
    program_files = os.getenv("ProgramFiles", r"C:\Program Files")
    winget_root = os.path.join(local_app_data, "Microsoft", "WinGet", "Packages")
    candidates = [
        os.path.join(local_app_data, "Microsoft", "WinGet", "Links"),
        os.path.join(program_files, "poppler", "Library", "bin"),
    ]

    if os.path.isdir(winget_root):
        for entry in os.listdir(winget_root):
            if entry.startswith("oschwartz10612.Poppler_"):
                package_root = os.path.join(winget_root, entry)
                for child in os.listdir(package_root):
                    if child.startswith("poppler-"):
                        candidates.append(os.path.join(package_root, child, "Library", "bin"))

    for candidate in candidates:
        if os.path.exists(os.path.join(candidate, "pdfinfo.exe")):
            return candidate

    return None


def _pdf2image_kwargs() -> Dict[str, str]:
    poppler_bin = _resolve_poppler_bin_dir()
    if poppler_bin:
        return {"poppler_path": poppler_bin}
    return {}


_tesseract_cmd = _resolve_tesseract_cmd()
if _tesseract_cmd:
    pytesseract.pytesseract.tesseract_cmd = _tesseract_cmd
# ─────────────────────────────────────────────────────────────────────────────

from pdf2image import convert_from_path
from PIL import Image

UPS_RE   = re.compile(r"(1Z[0-9A-Z]{16})")
STORE_RE = re.compile(r"#\s*(\d{3,6})")
PO_RE    = re.compile(r"\b(4\d{7})\b")


def _normalise_tracking(tracking: str) -> str:
    return re.sub(r"[\s\-]", "", (tracking or "").upper())


def _status_log(*args: Any, **kwargs: Any) -> None:
    kwargs.setdefault("file", sys.stderr)
    kwargs.setdefault("flush", True)
    try:
        print(*args, **kwargs)
    except BrokenPipeError:
        return
    except OSError as exc:
        if getattr(exc, "errno", None) not in (22, 32):
            raise


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


@dataclass
class Item:
    vendor_item: str = ""
    michaels_sku: str = ""
    description: str = ""
    qty: int = 0


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


@dataclass
class Order:
    po: str
    store: str
    ship_to: Address
    ship_from: Address
    items: List[Item] = field(default_factory=list)
    packs: List[Pack] = field(default_factory=list)


# ===========================================================================
# OCR page data
# ===========================================================================

@dataclass
class PageOcrData:
    page_idx: int
    tracking: str = ""
    po: str = ""
    store: str = ""


@dataclass
class MatchAuditRow:
    label_page: int
    status: str
    match_method: str = ""
    ocr_tracking: str = ""
    ocr_po: str = ""
    ocr_store: str = ""
    xml_tracking: str = ""
    xml_po: str = ""
    xml_store: str = ""
    sscc: str = ""
    note: str = ""


class MatchFailureError(ValueError):
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
    elems = lin_seg.findall("./Element")
    out: Dict[str, str] = {}
    for i in range(0, len(elems) - 1, 2):
        q = (elems[i].attrib.get("Value") or "").strip()
        v = (elems[i + 1].attrib.get("Value") or "").strip()
        if q and v:
            out[q] = v
    return out


# ===========================================================================
# ASN parser
# ===========================================================================

def _parse_shipment_group(
    bsn_seg: ET.Element,
    hl_loops: List[ET.Element],
) -> Tuple[List[Order], List[Pack]]:
    event_code        = _get_elem(bsn_seg, "01")
    shipment_tracking = _get_elem(bsn_seg, "02")

    ship_date  = ""
    ship_from  = Address()
    ship_to_by_store: Dict[str, Address] = {}

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

        if level == "S":
            for td3 in hl.findall(".//SegmentRef[@ID='TD3']"):
                v = (_get_elem(td3, "03") or "").replace(" ", "")
                m = UPS_RE.search(v)
                if m:
                    shipment_tracking = m.group(1)
                    break
            for dtm in hl.findall(".//SegmentRef[@ID='DTM']"):
                if _get_elem(dtm, "01") == "011":
                    ship_date = _get_elem(dtm, "02")
                    break
            for n1loop in hl.findall(".//N1-LOOP"):
                n1 = n1loop.find("./SegmentRef[@ID='N1']")
                if n1 is None:
                    continue
                qual  = _get_elem(n1, "01")
                name  = _get_elem(n1, "02")
                store = _parse_store_from_n1(n1)
                n3    = n1loop.find("./SegmentRef[@ID='N3']")
                n4    = n1loop.find("./SegmentRef[@ID='N4']")
                addr  = Address(
                    name  = name,
                    line1 = _get_elem(n3, "01") if n3 is not None else "",
                    line2 = _get_elem(n3, "02") if n3 is not None else "",
                    city  = _get_elem(n4, "01") if n4 is not None else "",
                    state = _get_elem(n4, "02") if n4 is not None else "",
                    zip   = _get_elem(n4, "03") if n4 is not None else "",
                )
                if qual == "SF" and any([addr.name, addr.line1, addr.city]):
                    ship_from = addr
                if qual == "ST" and store:
                    ship_to_by_store[store] = addr

    orders: List[Order]    = []
    packs_flat: List[Pack] = []
    current_order: Optional[Order] = None
    current_pack:  Optional[Pack]  = None

    for hl in hl_loops:
        hl_seg = hl.find("./SegmentRef[@ID='HL']")
        if hl_seg is None:
            continue
        level = _get_elem(hl_seg, "03")

        if level == "O":
            prf   = hl.find("./SegmentRef[@ID='PRF']")
            po    = _get_elem(prf, "01") if prf is not None else ""
            store = ""
            for n1loop in hl.findall(".//N1-LOOP"):
                n1 = n1loop.find("./SegmentRef[@ID='N1']")
                if n1 is None:
                    continue
                qual = _get_elem(n1, "01")
                if qual == "BY":
                    cand = _get_elem(n1, "04")
                    if _looks_like_store(cand):
                        store = cand
                        break
                    store = _store_from_name(_get_elem(n1, "02")) or store
                if qual == "ST" and not store:
                    store = _parse_store_from_n1(n1) or store
            ship_to       = ship_to_by_store.get(store, Address())
            current_order = Order(po=po, store=store, ship_to=ship_to, ship_from=ship_from)
            orders.append(current_order)
            current_pack  = None

        elif level == "P" and current_order is not None:
            man  = hl.find("./SegmentRef[@ID='MAN']")
            sscc = _get_elem(man, "02") if man is not None else ""
            if not sscc:
                raise ValueError(f"Missing SSCC (MAN02) for PO {current_order.po}")

            pack_tracking = shipment_tracking
            for ref in hl.findall("./SegmentRef[@ID='REF']"):
                v = (_get_elem(ref, "02") or "").replace(" ", "")
                m = UPS_RE.search(v)
                if m:
                    pack_tracking = m.group(1)
                    break
            if pack_tracking == shipment_tracking:
                for td3 in hl.findall("./SegmentRef[@ID='TD3']"):
                    v = (_get_elem(td3, "03") or "").replace(" ", "")
                    m = UPS_RE.search(v)
                    if m:
                        pack_tracking = m.group(1)
                        break

            current_pack = Pack(
                sscc       = sscc,
                tracking   = pack_tracking,
                po         = current_order.po,
                store      = current_order.store,
                ship_date  = ship_date,
                ship_from  = current_order.ship_from,
                ship_to    = current_order.ship_to,
                event_code = event_code,
            )
            current_order.packs.append(current_pack)
            packs_flat.append(current_pack)

        elif level == "I" and current_order is not None:
            lin  = hl.find("./SegmentRef[@ID='LIN']")
            sn1  = hl.find("./SegmentRef[@ID='SN1']")
            pid  = hl.find("./SegmentRef[@ID='PID']")
            pairs        = _parse_lin_pairs(lin)
            vendor_item  = pairs.get("VN", "")
            michaels_sku = pairs.get("CB", "") or pairs.get("UK", "")
            qty_s = _get_elem(sn1, "02") if sn1 is not None else "0"
            try:
                qty = int(qty_s)
            except Exception:
                qty = 0
            desc = _get_elem(pid, "05") if pid is not None else ""
            item = Item(vendor_item=vendor_item, michaels_sku=michaels_sku,
                        description=desc, qty=qty)
            current_order.items.append(item)
            if current_pack is not None:
                current_pack.items.append(item)

    seen_sscc: set = set()
    deduped: List[Pack] = []
    for p in packs_flat:
        if p.sscc not in seen_sscc:
            seen_sscc.add(p.sscc)
            deduped.append(p)

    return orders, deduped


def parse_asn(xml_path: str) -> Tuple[List[Order], List[Pack]]:
    root = ET.parse(xml_path).getroot()

    parent_map: Dict[ET.Element, List[Tuple[int, ET.Element]]] = {}
    for elem in root.iter():
        children = list(elem)
        for idx, child in enumerate(children):
            tag    = child.tag
            seg_id = child.attrib.get("ID", "")
            if (tag == "SegmentRef" and seg_id == "BSN") or tag == "HL-LOOP":
                parent_map.setdefault(elem, []).append((idx, child))

    all_orders: List[Order] = []
    all_packs:  List[Pack]  = []

    for parent, items in parent_map.items():
        groups: List[Tuple[ET.Element, List[ET.Element]]] = []
        current_bsn: Optional[ET.Element] = None
        current_hls: List[ET.Element]     = []

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

    # Deduplicate by SSCC
    seen: set = set()
    deduped: List[Pack] = []
    for p in all_packs:
        if p.sscc not in seen:
            seen.add(p.sscc)
            deduped.append(p)

    return all_orders, deduped


# ===========================================================================
# Build lookup indexes from XML packs
# ===========================================================================

def build_pack_indexes(
    packs: List[Pack],
) -> Tuple[
    Dict[str, Pack],
    Dict[str, List[Pack]],
    Dict[str, List[Pack]],
    Dict[Tuple[str, str], List[Pack]],
]:
    """
    Return lookup maps for matching shipping-label OCR results to XML packs.
    Exact tracking is preferred; PO/store fallbacks are only used when they
    identify a single unambiguous pack.
    """
    by_tracking: Dict[str, Pack] = {}
    by_po: Dict[str, List[Pack]] = {}
    by_store: Dict[str, List[Pack]] = {}
    by_po_store: Dict[Tuple[str, str], List[Pack]] = {}

    for p in packs:
        t = _normalise_tracking(p.tracking)
        if t:
            by_tracking[t] = p

        po = (p.po or "").strip()
        if po:
            by_po.setdefault(po, []).append(p)

        st = (p.store or "").strip()
        if st:
            by_store.setdefault(st, []).append(p)

        if po and st:
            by_po_store.setdefault((po, st), []).append(p)

    return by_tracking, by_po, by_store, by_po_store


# ===========================================================================
# OCR helpers
# ===========================================================================

def _ocr_image(img: Image.Image) -> str:
    w, h = img.size
    if w < 1200:
        scale = 1200 / w
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return pytesseract.image_to_string(img, config="--psm 6")


def _extract_page_identifiers(raw_text: str) -> Tuple[str, str, str]:
    clean = re.sub(r"[\s\-]", "", raw_text).upper()

    # 1. Tracking number
    tracking = ""
    m = UPS_RE.search(clean)
    if m:
        tracking = m.group(1)
    else:
        normalized = clean.replace("O","0").replace("I","1").replace("L","1").replace("B","8").replace("S","5")
        m2 = UPS_RE.search(normalized)
        if m2:
            tracking = clean[m2.start():m2.end()]

    # 2. PO number
    po = ""
    m_po = re.search(r"PO#?\s*(\d{8})", raw_text, re.IGNORECASE)
    if m_po:
        po = m_po.group(1)
    if not po:
        m_po = re.search(r"PO#?(\d{8})", clean, re.IGNORECASE)
        if m_po:
            po = m_po.group(1)
    if not po:
        m_po = PO_RE.search(raw_text)
        if m_po:
            po = m_po.group(1)

    # 3. Store number
    store = ""
    m3 = STORE_RE.search(raw_text)
    if m3:
        store = m3.group(1)
    if not store:
        m3 = re.search(r"#(\d{3,6})", clean)
        if m3:
            store = m3.group(1)

    return tracking, po, store


# ===========================================================================
# Shipping page extraction — with corrupt-page fallback
# ===========================================================================

def _shipping_page_to_bytes(fitz_doc: fitz.Document, page_idx: int) -> bytes:
    """
    Rasterise a shipping label page at 200 DPI and wrap it in a fresh
    ReportLab PDF.  Always rasterising (never copying the raw vector page)
    guarantees corrupt font/XObject resources in the source PDF never
    poison the PdfWriter and never produce blank pages in the output.
    """
    page      = fitz_doc[page_idx]
    mat       = fitz.Matrix(200 / 72, 200 / 72)   # 200 DPI
    pix       = page.get_pixmap(matrix=mat, alpha=False)
    img_bytes = pix.tobytes("png")
    rect      = page.rect
    pw, ph    = rect.width, rect.height

    buf = io.BytesIO()
    c   = canvas.Canvas(buf, pagesize=(pw, ph))
    c.drawImage(ImageReader(io.BytesIO(img_bytes)), 0, 0, width=pw, height=ph)
    c.showPage()
    c.save()
    return buf.getvalue()


# ===========================================================================
# Text / layout helpers
# ===========================================================================

def wrap_text(text: str, font_name: str, font_size: float, max_width: float) -> List[str]:
    text = (text or "").strip()
    if not text:
        return [""]
    words = text.split()
    lines: List[str] = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def hard_wrap(text: str, font_name: str, font_size: float, max_width: float) -> List[str]:
    words = (text or "").strip().split()
    lines: List[str] = []
    for word in words:
        if pdfmetrics.stringWidth(word, font_name, font_size) <= max_width:
            if not lines:
                lines.append(word)
            else:
                test = lines[-1] + " " + word
                if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
                    lines[-1] = test
                else:
                    lines.append(word)
        else:
            cur = ""
            for ch in word:
                test = cur + ch
                if pdfmetrics.stringWidth(test, font_name, font_size) <= max_width:
                    cur = test
                else:
                    if cur:
                        lines.append(cur)
                    cur = ch
            if cur:
                lines.append(cur)
    return lines or [""]


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


def format_michaels_item_number(raw_cb: str) -> str:
    s = (raw_cb or "").strip()
    if s.isdigit() and len(s) == 6:
        return "10" + s
    return s


# ===========================================================================
# PDF renderers
# ===========================================================================

def render_gs1_label_page(pack: Pack, order_index: int, total_orders: int) -> bytes:
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    FS_ADDR        = 12
    FS_INFO        = 14
    FS_STORE_LABEL = 12
    FS_STORE       = 36
    FS_BAR_HR      = 10
    LH_ADDR        = 0.155 * inch
    LH_INFO        = 0.24 * inch
    margin         = 0.12 * inch
    pad            = 0.10 * inch

    c.setLineWidth(2)
    c.rect(margin, margin, W - 2 * margin, H - 2 * margin)

    inner_left  = margin
    inner_right = W - margin
    xL          = inner_left + pad
    xR          = W / 2 + pad
    left_w      = W / 2 - margin - pad
    right_w     = W / 2 - pad - margin

    top_section_h = 1.65 * inch
    top_y0        = H - margin - top_section_h

    c.setLineWidth(1.5)
    c.line(inner_left, top_y0, inner_right, top_y0)
    c.line(W / 2, top_y0, W / 2, H - margin)

    sf = pack.ship_from
    st = pack.ship_to
    yT = H - margin - 0.28 * inch

    c.setFont("Helvetica-Bold", FS_ADDR)
    c.drawString(xL, yT, "SHIP FROM:")
    y = yT - 0.18 * inch
    c.setFont("Helvetica", FS_ADDR)
    for line in [sf.name, sf.line1, sf.line2, f"{sf.city} {sf.state} {sf.zip}".strip()]:
        for w in wrap_text(line, "Helvetica", FS_ADDR, left_w):
            if w.strip():
                c.drawString(xL, y, w)
                y -= LH_ADDR

    y = yT
    c.setFont("Helvetica-Bold", FS_ADDR)
    c.drawString(xR, y, "SHIP TO:")
    y -= 0.18 * inch
    c.setFont("Helvetica", FS_ADDR)
    for w in wrap_text(st.name, "Helvetica", FS_ADDR, right_w):
        if w.strip():
            c.drawString(xR, y, w)
            y -= LH_ADDR
    for line in [st.line1, st.line2, f"{st.city} {st.state} {st.zip}".strip()]:
        for w in wrap_text(line, "Helvetica", FS_ADDR, right_w):
            if w.strip():
                c.drawString(xR, y, w)
                y -= LH_ADDR

    y = top_y0 - 0.25 * inch
    c.setFont("Helvetica-Bold", FS_INFO)
    c.drawString(xL, y, f"PO# {pack.po}")
    y -= LH_INFO

    ec = (pack.event_code or "").strip()
    if ec in ("", "0", "00", "000", "0 0"):
        ec = ""
    c.setFont("Helvetica-Bold", FS_INFO)
    c.drawString(xL, y, "Event Code:")
    if ec:
        c.setFont("Helvetica", FS_INFO)
        lw = pdfmetrics.stringWidth("Event Code:  ", "Helvetica-Bold", FS_INFO)
        c.drawString(xL + lw, y, ec)
    y -= LH_INFO

    tv = (pack.tracking or "").strip()
    c.setFont("Helvetica-Bold", FS_INFO)
    c.drawString(xL, y, "Tracking Code:")
    if tv:
        c.setFont("Helvetica", FS_INFO)
        lw      = pdfmetrics.stringWidth("Tracking Code: ", "Helvetica-Bold", FS_INFO)
        avail_w = inner_right - margin - (xL + lw)
        tlines  = wrap_text(tv, "Helvetica", FS_INFO, avail_w)
        c.drawString(xL + lw, y, tlines[0])
    y -= LH_INFO

    store_row_h = 0.92 * inch
    store_top   = y
    store_bot   = store_top - store_row_h

    c.setLineWidth(1.5)
    c.line(inner_left, store_top, inner_right, store_top)
    c.line(inner_left, store_bot, inner_right, store_bot)
    c.line(W / 2, store_bot, W / 2, store_top)

    store_mid = (store_top + store_bot) / 2
    c.setFont("Helvetica", FS_STORE_LABEL)
    c.drawCentredString(W / 2 + (W / 2 - margin) / 2, store_mid + 0.28 * inch, "STORE")
    c.setFont("Helvetica-Bold", FS_STORE)
    c.drawCentredString(W / 2 + (W / 2 - margin) / 2, store_mid - 0.22 * inch, pack.store or "")

    sscc18    = normalize_sscc(pack.sscc)
    gs1_value = "\xf1" + "00" + sscc18
    bar_h     = 1.10 * inch
    sscc_bar  = code128.Code128(gs1_value, barHeight=bar_h, barWidth=0.0195 * inch)
    bc_y      = margin + 0.5 * inch
    bc_x      = (W - sscc_bar.width) / 2.0

    c.setFont("Helvetica-Bold", FS_BAR_HR)
    c.drawCentredString(W / 2, bc_y + bar_h + 0.10 * inch,
                        f"(00) {format_sscc_groups(sscc18)}")
    sscc_bar.drawOn(c, bc_x, bc_y)

    c.showPage()
    c.save()
    return buf.getvalue()


def render_packing_list_pages(pack: Pack, order_index: int, total_orders: int) -> bytes:
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    margin   = 0.12 * inch
    pad      = 0.10 * inch
    usable_w = W - 2 * margin
    right    = W - margin

    w_vendor = 0.70 * inch
    w_sku    = 0.49 * inch
    w_desc   = 1.22 * inch
    w_qo     = 0.32 * inch
    w_qf     = 0.30 * inch
    w_cases  = 0.30 * inch
    w_ppc    = usable_w - (w_vendor + w_sku + w_desc + w_qo + w_qf + w_cases)

    x_vendor = margin
    x_sku    = x_vendor + w_vendor
    x_desc   = x_sku + w_sku
    x_qo     = x_desc + w_desc
    x_qf     = x_qo + w_qo
    x_cases  = x_qf + w_qf
    x_ppc    = x_cases + w_cases

    font      = 6.5
    font_desc = 7.5
    line_h    = font + 3

    items   = sorted(pack.items, key=lambda it: (it.michaels_sku or ""))
    idx     = 0
    page_no = 1

    def estimate_total_pages() -> int:
        total = 1
        y = H - margin - 1.70 * inch
        for it in items:
            desc_lines = hard_wrap(it.description, "Helvetica", font_desc, w_desc - 4)
            vend_lines = hard_wrap(it.vendor_item,  "Helvetica", font,      w_vendor - 4)
            row_height = max(len(vend_lines), len(desc_lines), 1) * line_h + 6
            if y - row_height < margin + 0.25 * inch:
                y = H - margin - 0.60 * inch
                total += 1
            y -= row_height
        return total

    total_pages = estimate_total_pages()

    def draw_table_header(y_top: float) -> float:
        header_h = 26
        c.setFillColorRGB(1, 1, 1)
        c.rect(margin, y_top - header_h, usable_w, header_h, fill=1, stroke=1)
        c.setFillColorRGB(0, 0, 0)
        c.setLineWidth(0.4)
        for x_div in [x_sku, x_desc, x_qo, x_qf, x_cases, x_ppc]:
            c.line(x_div, y_top - header_h, x_div, y_top)
        c.setFont("Helvetica-Bold", 5.6)
        ty = y_top - 8
        c.drawString(x_vendor + 2, ty,      "VENDOR")
        c.drawString(x_vendor + 2, ty - 7,  "ITEM")
        c.drawString(x_vendor + 2, ty - 14, "NUMBER")
        c.drawString(x_sku + 2,    ty,      "MICHAELS")
        c.drawString(x_sku + 2,    ty - 7,  "ITEM")
        c.drawString(x_sku + 2,    ty - 14, "SKU")
        c.drawString(x_desc + 2,   ty,      "ITEM")
        c.drawString(x_desc + 2,   ty - 7,  "DESCRIPTION")
        c.drawString(x_qo + 2,     ty,      "QTY")
        c.drawString(x_qo + 2,     ty - 7,  "ORD")
        c.drawString(x_qf + 2,     ty,      "QTY")
        c.drawString(x_qf + 2,     ty - 7,  "FUL")
        c.drawString(x_cases + 2,  ty,      "#")
        c.drawString(x_cases + 2,  ty - 7,  "CASE")
        c.drawString(x_ppc + 2,    ty,      "PCS/")
        c.drawString(x_ppc + 2,    ty - 7,  "CASE")
        return y_top - header_h

    while True:
        y = H - margin

        if page_no == 1:
            title_h = 16
            c.setFillColorRGB(0, 0, 0)
            c.rect(margin, y - title_h, usable_w, title_h, fill=1, stroke=0)
            c.setFillColorRGB(1, 1, 1)
            c.setFont("Helvetica-Bold", 10)
            c.drawCentredString(W / 2, y - title_h + 4, "PACKING LIST")
            c.setFillColorRGB(0, 0, 0)
            y -= title_h + 12

            sf = pack.ship_from
            st = pack.ship_to
            c.setFont("Helvetica-Bold", 6.5)
            c.drawString(margin, y, "SHIP FROM:")
            c.drawString(W / 2 + 4, y, "SHIP TO:")
            y -= 10

            c.setFont("Helvetica", 6.2)
            left_lines  = [l for l in [sf.name, sf.line1, sf.line2,
                            f"{sf.city}, {sf.state} {sf.zip}".strip(", ")] if l.strip()]
            right_lines = [l for l in [st.name, st.line1, st.line2,
                            f"{st.city}, {st.state} {st.zip}".strip(", ")] if l.strip()]
            for i in range(max(len(left_lines), len(right_lines))):
                if i < len(left_lines):
                    c.drawString(margin, y, left_lines[i][:36])
                if i < len(right_lines):
                    c.drawString(W / 2 + 4, y, right_lines[i][:36])
                y -= 9

            y -= 4
            c.setLineWidth(0.5)
            c.line(margin, y, right, y)
            y -= 10

            c.setFont("Helvetica-Bold", 7)
            c.drawString(margin, y, f"PO#: {pack.po}")
            c.drawRightString((margin + right)/2, y, f"Order {order_index} of {total_orders}")
            c.drawRightString(right, y, f"Ship Date: {pack.ship_date or '________'}")
            y -= 8


        else:
            c.setFont("Helvetica-Bold", 7)
            c.drawString(margin, y - 10, f"PO#: {pack.po} (cont..)")
            y -= 20

        y = draw_table_header(y)
        bottom_limit = margin + 0.25 * inch

        while idx < len(items):
            it = items[idx]
            vend_lines = hard_wrap(it.vendor_item,  "Helvetica", font,      w_vendor - 4)
            sku_str    = format_michaels_item_number(it.michaels_sku)[:12]
            desc_lines = hard_wrap(it.description,  "Helvetica", font_desc, w_desc - 4)
            row_lines  = max(len(vend_lines), len(desc_lines), 1)
            row_height = row_lines * line_h + 6

            if y - row_height < bottom_limit:
                break

            c.setLineWidth(0.4)
            c.rect(x_vendor, y - row_height, usable_w, row_height)
            for x_div in [x_sku, x_desc, x_qo, x_qf, x_cases, x_ppc]:
                c.line(x_div, y - row_height, x_div, y)

            text_y = y - line_h + 1
            for li in range(row_lines):
                y_line = text_y - li * line_h
                if li < len(vend_lines):
                    c.setFont("Helvetica", font)
                    c.drawString(x_vendor + 2, y_line, vend_lines[li])
                if li == 0:
                    c.setFont("Helvetica", font)
                    c.drawString(x_sku + 2, y_line, sku_str)
                    c.setFont("Helvetica-Bold", 7.5)
                    c.drawCentredString(x_qo + w_qo / 2, y_line, str(it.qty))
                    c.setFont("Helvetica", font)
                    c.drawCentredString(x_qf    + w_qf / 2,    y_line, str(it.qty))
                    c.drawCentredString(x_cases + w_cases / 2, y_line, "1")
                    c.drawCentredString(x_ppc   + w_ppc / 2,  y_line, str(it.qty))
                if li < len(desc_lines):
                    c.setFont("Helvetica-Bold", font_desc)
                    c.drawString(x_desc + 2, y_line, desc_lines[li])

            y -= row_height
            idx += 1

        if total_pages > 1:
            c.setFont("Helvetica", 6)
            c.drawCentredString(W / 2, margin, f"Page {page_no} of {total_pages}")

        c.showPage()
        page_no += 1
        if idx >= len(items):
            break

    c.save()
    return buf.getvalue()


def render_no_xml_match_page(pd: PageOcrData) -> bytes:
    """Placeholder GS1/packing page when OCR found identifiers but no XML pack matched."""
    buf = io.BytesIO()
    W, H = 4 * inch, 6 * inch
    c = canvas.Canvas(buf, pagesize=(W, H))

    margin = 0.20 * inch
    c.setLineWidth(1.5)
    c.setStrokeColorRGB(0.6, 0.6, 0.6)
    c.rect(margin, margin, W - 2 * margin, H - 2 * margin)

    c.setFillColorRGB(0.2, 0.2, 0.2)
    c.setFont("Helvetica-Bold", 12)
    c.drawCentredString(W / 2, H / 2 + 0.55 * inch, "⚠  NO XML MATCH FOUND")

    c.setFont("Helvetica", 9)
    if pd.tracking:
        c.drawCentredString(W / 2, H / 2 + 0.15 * inch, f"Tracking: {pd.tracking}")
    if pd.po:
        c.drawCentredString(W / 2, H / 2 - 0.10 * inch, f"PO: {pd.po}")
    if pd.store:
        c.drawCentredString(W / 2, H / 2 - 0.30 * inch, f"Store: {pd.store}")

    c.setFont("Helvetica", 7.5)
    c.setFillColorRGB(0.5, 0.5, 0.5)
    c.drawCentredString(W / 2, margin + 0.15 * inch,
                        "Check XML — no pack matched this shipping label")
    c.showPage()
    c.save()
    return buf.getvalue()


# ===========================================================================
# Core rendering — shipping-label-first
# ===========================================================================

def _bytes_to_fitz(data: bytes) -> fitz.Document:
    """Open PDF bytes as a fitz Document."""
    return fitz.open(stream=data, filetype="pdf")


def _pack_debug_label(pack: Pack) -> str:
    return (
        f"PO={pack.po or 'missing'}, store={pack.store or 'missing'}, "
        f"tracking={pack.tracking or 'missing'}, SSCC={pack.sscc or 'missing'}"
    )


def _row_for_report(
    page_number: int,
    status: str,
    tracking: str,
    po: str,
    store: str,
    pack: Optional[Pack],
    match_method: str,
    note: str = "",
) -> Dict[str, Any]:
    return {
        "label_page": page_number,
        "status": status,
        "match_method": match_method,
        "ocr_tracking": tracking,
        "ocr_po": po,
        "ocr_store": store,
        "xml_tracking": pack.tracking if pack else "",
        "xml_po": pack.po if pack else "",
        "xml_store": pack.store if pack else "",
        "sscc": pack.sscc if pack else "",
        "note": note,
    }


def _match_pack(
    tracking: str,
    po: str,
    store: str,
    by_tracking: Dict[str, Pack],
    by_po: Dict[str, List[Pack]],
    by_store: Dict[str, List[Pack]],
    by_po_store: Dict[Tuple[str, str], List[Pack]],
) -> Tuple[Optional[Pack], str]:
    norm_t = _normalise_tracking(tracking)
    if norm_t and norm_t in by_tracking:
        return by_tracking[norm_t], f"Tracking={tracking}"

    po_key = (po or "").strip()
    store_key = (store or "").strip()

    if store_key:
        candidates = by_store.get(store_key, [])
        if len(candidates) == 1:
            return candidates[0], f"Store={store_key}"

    return None, ""


def _build_match_report(
    report_rows: List[Dict[str, Any]],
    all_packs: List[Pack],
    used_pack_ssccs: set[str],
    shipping_pages: int,
    output_order: str = "Uploaded PDF order",
) -> Dict[str, Any]:
    unused_packs: List[Pack] = []
    seen_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_ssccs:
            continue
        seen_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    matched_pages = sum(1 for row in report_rows if row.get("status") == "matched")
    report = {
        "matching_rules": [
            "1. Exact tracking number match",
            "2. Unique store-only match",
        ],
        "summary": {
            "output_order": output_order,
            "success": matched_pages == shipping_pages and len(unused_packs) == 0,
            "shipping_pages": shipping_pages,
            "xml_packs": len(all_packs),
            "matched_pages": matched_pages,
            "unmatched_pages": sum(1 for row in report_rows if row.get("status") != "matched"),
            "unused_xml_packs": len(unused_packs),
        },
        "rows": report_rows,
        "unused_xml_packs": [
            {
                "po": pack.po,
                "store": pack.store,
                "tracking": pack.tracking,
                "sscc": pack.sscc,
            }
            for pack in unused_packs
        ],
    }
    return report


def _build_match_failure_message(
    unmatched_details: List[PageOcrData],
    all_packs: List[Pack],
    used_pack_ssccs: set[str],
    duplicate_messages: Optional[List[str]] = None,
) -> str:
    lines = ["Shipping label to XML matching failed."]

    if unmatched_details:
        lines.append("Unmatched label pages:")
        for pd in unmatched_details:
            lines.append(
                f"- Label page {pd.page_idx + 1}: tracking={pd.tracking or 'not found'}, "
                f"PO={pd.po or 'not found'}, store={pd.store or 'not found'}"
            )

    if duplicate_messages:
        lines.append("Duplicate shipping labels matched the same XML pack:")
        lines.extend(duplicate_messages)

    unused_packs: List[Pack] = []
    seen_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_ssccs:
            continue
        seen_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    if unused_packs:
        lines.append("XML packs with no matched shipping label:")
        for pack in unused_packs[:20]:
            lines.append(f"- {_pack_debug_label(pack)}")
        if len(unused_packs) > 20:
            lines.append(f"- ... plus {len(unused_packs) - 20} more XML pack(s)")

    return "\n".join(lines)


def _render_shipping_label_first(
    fitz_doc: fitz.Document,
    shipping_pdf_path: str,
    all_packs: List[Pack],
    by_tracking: Dict[str, Pack],
    by_po: Dict[str, List[Pack]],
    by_store: Dict[str, List[Pack]],
    by_po_store: Dict[Tuple[str, str], List[Pack]],
    out_pdf: str,
    ocr_dpi: int,
    group_by_shipping_pdf: bool = True,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Iterate shipping label pages one by one.
    For each page:
      1. OCR → tracking / PO / store
      2. Look up matching XML pack  (tracking → PO → store)
      3. Emit: shipping page  →  GS1 label  →  packing list

    Uses fitz (PyMuPDF) for final assembly — avoids PyPDF2 resource
    cross-linking bugs that corrupt page ordering when merging mixed sources.
    """
    n_pages = fitz_doc.page_count
    _status_log(f"  Shipping PDF has {n_pages} page(s). OCR-ing at {ocr_dpi} DPI...")

    pdf2image_kwargs = _pdf2image_kwargs()
    images = convert_from_path(shipping_pdf_path, dpi=ocr_dpi, **pdf2image_kwargs)
    total  = len(images)

    # ── Phase 1: Parallel OCR ─────────────────────────────────────────────
    _status_log(f"  Running OCR on {total} page(s) in parallel…")
    ocr_done  = [0]
    ocr_lock  = threading.Lock()

    def _ocr_one_page(args: Tuple[int, Any]) -> Tuple[int, str, str, str]:
        page_idx, img = args
        raw_text = _ocr_image(img)
        tracking, po, store = _extract_page_identifiers(raw_text)
        if not tracking and not po and not store:
            _status_log(f"  Page {page_idx+1}: nothing at {ocr_dpi} DPI, retrying at 300…")
            hd_imgs = convert_from_path(
                shipping_pdf_path, dpi=300,
                first_page=page_idx + 1, last_page=page_idx + 1,
                **pdf2image_kwargs,
            )
            if hd_imgs:
                raw_text = _ocr_image(hd_imgs[0])
                tracking, po, store = _extract_page_identifiers(raw_text)
        with ocr_lock:
            ocr_done[0] += 1
            done = ocr_done[0]
        if progress_callback:
            progress_callback(f"Scanning labels: {done} of {total} pages OCR'd…")
        return page_idx, tracking, po, store

    workers = min(4, total)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        # map preserves submission order → results[i] corresponds to page i
        ocr_results: List[Tuple[int, str, str, str]] = list(
            executor.map(_ocr_one_page, enumerate(images))
        )

    # ── Phase 2: Sequential match + render ───────────────────────────────
    out_doc         = fitz.open()
    used_pack_ssccs: set[str] = set()
    matched_page_by_sscc: Dict[str, int] = {}
    unmatched_pages: List[int] = []
    unmatched_details: List[PageOcrData] = []
    duplicate_messages: List[str] = []
    report_rows: List[Dict[str, Any]] = []
    bundle_ranges: List[Dict[str, int]] = []
    xml_order_by_pack = {
        (pack.sscc.strip(), pack.po.strip(), pack.store.strip()): index
        for index, pack in enumerate(all_packs)
    }
    order_index = 0

    for page_idx, tracking, po, store in ocr_results:
        # ── Match to XML pack ─────────────────────────────────────────────
        pack, match_method = _match_pack(
            tracking=tracking,
            po=po,
            store=store,
            by_tracking=by_tracking,
            by_po=by_po,
            by_store=by_store,
            by_po_store=by_po_store,
        )

        # ── Log ───────────────────────────────────────────────────────────
        ocr_tag = tracking or (f"PO={po}" if po else "") or (f"store={store}" if store else "") or "⚠ nothing"
        page_data = PageOcrData(page_idx=page_idx, tracking=tracking, po=po, store=store)

        # ── Progress callback ─────────────────────────────────────────────
        if progress_callback:
            matched_so_far = len(matched_page_by_sscc)
            progress_callback(
                f"Rendering page {page_idx + 1} of {total} — "
                f"{matched_so_far} matched so far…"
            )

        if pack and pack.sscc in matched_page_by_sscc:
            first_page = matched_page_by_sscc[pack.sscc]
            duplicate_note = f"Duplicate of label page {first_page}"
            duplicate_messages.append(
                f"- Label page {page_idx + 1} duplicated XML pack already used by label page {first_page}: "
                f"{_pack_debug_label(pack)}"
            )
            report_rows.append(
                _row_for_report(page_idx + 1, "duplicate", tracking, po, store, pack, match_method, duplicate_note)
            )
            unmatched_pages.append(page_idx + 1)
            unmatched_details.append(page_data)
            _status_log(
                f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  ⚠ duplicate XML match "
                f"(already used on page {first_page})"
            )
            pack = None
        elif pack:
            matched_page_by_sscc[pack.sscc] = page_idx + 1
            order_index += 1
            report_rows.append(
                _row_for_report(page_idx + 1, "matched", tracking, po, store, pack, match_method, "Matched successfully")
            )
            _status_log(
                f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  PO={pack.po}  store={pack.store}"
                f"  [{match_method}]"
            )
            used_pack_ssccs.add(pack.sscc)
        else:
            report_rows.append(
                _row_for_report(page_idx + 1, "unmatched", tracking, po, store, None, "", "No XML pack matched this label")
            )
            unmatched_pages.append(page_idx + 1)
            unmatched_details.append(page_data)
            _status_log(f"  Page {page_idx+1:>3}  OCR={ocr_tag:<22}  →  ⚠ no XML match")

        # ── 1. Shipping page — rasterised, guaranteed exactly one page ────
        bundle_start = out_doc.page_count
        ship_bytes = _shipping_page_to_bytes(fitz_doc, page_idx)
        ship_fitz  = _bytes_to_fitz(ship_bytes)
        out_doc.insert_pdf(ship_fitz, from_page=0, to_page=0)
        ship_fitz.close()

        # ── 2. GS1 label — always exactly one page ────────────────────────
        if pack:
            pack_key = (pack.sscc.strip(), pack.po.strip(), pack.store.strip())
            render_order_index = (
                order_index
                if group_by_shipping_pdf
                else xml_order_by_pack.get(pack_key, order_index - 1) + 1
            )
            gs1_bytes = render_gs1_label_page(pack, order_index=render_order_index, total_orders=total)
        else:
            pd_obj    = PageOcrData(page_idx=page_idx, tracking=tracking, po=po, store=store)
            gs1_bytes = render_no_xml_match_page(pd_obj)
        gs1_fitz = _bytes_to_fitz(gs1_bytes)
        out_doc.insert_pdf(gs1_fitz, from_page=0, to_page=0)
        gs1_fitz.close()

        # ── 3. Packing list — one or more pages ───────────────────────────
        if pack:
            pl_bytes = render_packing_list_pages(pack, order_index=render_order_index, total_orders=total)
            pl_fitz  = _bytes_to_fitz(pl_bytes)
            out_doc.insert_pdf(pl_fitz)          # all pages
            pl_fitz.close()
            bundle_ranges.append(
                {
                    "label_page": page_idx + 1,
                    "rank": render_order_index,
                    "from_page": bundle_start,
                    "to_page": out_doc.page_count - 1,
                }
            )

    unused_packs = []
    seen_unused_ssccs: set[str] = set()
    for pack in all_packs:
        if pack.sscc in used_pack_ssccs or pack.sscc in seen_unused_ssccs:
            continue
        seen_unused_ssccs.add(pack.sscc)
        unused_packs.append(pack)

    if unmatched_pages:
        _status_log(
            f"\n⚠  {len(unmatched_pages)} shipping page(s) had no XML match: "
            f"{unmatched_pages}"
        )
    if unused_packs:
        _status_log(
            f"\n⚠  {len(unused_packs)} XML pack(s) had no shipping label page: "
            f"{[_pack_debug_label(pack) for pack in unused_packs[:10]]}"
        )

    output_order = "Uploaded PDF order" if group_by_shipping_pdf else "ASN XML order"
    report = _build_match_report(
        report_rows,
        all_packs,
        used_pack_ssccs,
        n_pages,
        output_order=output_order,
    )

    if unmatched_pages or unused_packs or duplicate_messages:
        out_doc.close()
        raise MatchFailureError(
            _build_match_failure_message(
                unmatched_details,
                all_packs,
                used_pack_ssccs,
                duplicate_messages=duplicate_messages,
            ),
            report=report,
        )

    if not group_by_shipping_pdf:
        xml_order_doc = fitz.open()
        next_output_page = 0
        for bundle in sorted(bundle_ranges, key=lambda item: item["rank"]):
            from_page = bundle["from_page"]
            to_page = bundle["to_page"]
            xml_order_doc.insert_pdf(out_doc, from_page=from_page, to_page=to_page)
            bundle["final_from_page"] = next_output_page
            bundle["final_to_page"] = next_output_page + (to_page - from_page)
            next_output_page = bundle["final_to_page"] + 1
        out_doc.close()
        out_doc = xml_order_doc
    else:
        for bundle in bundle_ranges:
            bundle["final_from_page"] = bundle["from_page"]
            bundle["final_to_page"] = bundle["to_page"]

    output_range_by_label = {bundle["label_page"]: bundle for bundle in bundle_ranges}
    for row in report_rows:
        bundle = output_range_by_label.get(int(row.get("label_page") or 0))
        if bundle:
            row["output_start_page"] = bundle["final_from_page"] + 1
            row["output_end_page"] = bundle["final_to_page"] + 1

    out_doc.save(out_pdf, garbage=4, deflate=True)
    out_doc.close()
    _status_log(f"\n✓  All {n_pages} shipping page(s) matched to XML packs.")
    return report


# ===========================================================================
# Public API
# ===========================================================================

def run_pipeline(
    xml_paths: List[str],
    out_pdf: str,
    shipping_pdf_path: Optional[str] = None,
    ocr_dpi: int = 200,
    group_by_shipping_pdf: bool = True,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    all_packs: List[Pack] = []
    for xp in xml_paths:
        _status_log(f"Parsing XML: {xp}")
        _orders, packs = parse_asn(xp)
        all_packs.extend(packs)

    # Deduplicate by (sscc, po, store)
    seen_keys: set = set()
    deduped: List[Pack] = []
    for p in all_packs:
        key = (p.sscc.strip(), p.po.strip(), p.store.strip())
        if key not in seen_keys:
            seen_keys.add(key)
            deduped.append(p)
    if len(deduped) < len(all_packs):
        _status_log(f"  Removed {len(all_packs) - len(deduped)} duplicate pack(s).")
    all_packs = deduped
    _status_log(f"  Total packs in XML: {len(all_packs)}")

    if shipping_pdf_path:
        by_tracking, by_po, by_store, by_po_store = build_pack_indexes(all_packs)
        fitz_doc = fitz.open(shipping_pdf_path)
        _status_log(f"\nRendering output PDF: {out_pdf}")
        report = _render_shipping_label_first(
            fitz_doc           = fitz_doc,
            shipping_pdf_path  = shipping_pdf_path,
            all_packs          = all_packs,
            by_tracking        = by_tracking,
            by_po              = by_po,
            by_store           = by_store,
            by_po_store        = by_po_store,
            out_pdf            = out_pdf,
            ocr_dpi            = ocr_dpi,
            group_by_shipping_pdf = group_by_shipping_pdf,
            progress_callback  = progress_callback,
        )
    else:
        # No shipping PDF — just GS1 + packing list, assembled with fitz
        _status_log(f"Rendering output PDF (no shipping labels): {out_pdf}")
        out_doc = fitz.open()
        total   = len(all_packs)
        report_rows: List[Dict[str, Any]] = []
        for i, pack in enumerate(all_packs, start=1):
            gs1_bytes = render_gs1_label_page(pack, order_index=i, total_orders=total)
            gs1_fitz  = _bytes_to_fitz(gs1_bytes)
            out_doc.insert_pdf(gs1_fitz, from_page=0, to_page=0)
            gs1_fitz.close()
            pl_bytes = render_packing_list_pages(pack, order_index=i, total_orders=total)
            pl_fitz  = _bytes_to_fitz(pl_bytes)
            out_doc.insert_pdf(pl_fitz)
            pl_fitz.close()
            report_rows.append(
                _row_for_report(i, "matched", "", pack.po, pack.store, pack, "No shipping PDF", "Generated from XML only")
            )
        out_doc.save(out_pdf, garbage=4, deflate=True)
        out_doc.close()
        report = _build_match_report(report_rows, all_packs, {p.sscc for p in all_packs}, len(report_rows))

    _status_log(f"✓  Done → {out_pdf}")
    return report


# ===========================================================================
# CLI C:\Users\JDID Employee\Downloads\label-app\label-app\src\label_pipeline.py
# ===========================================================================

def main(argv: Optional[List[str]] = None) -> None:
    parser = argparse.ArgumentParser(
        description="Generate label + packing list PDF from ASN XML"
    )
    parser.add_argument("--xml",      nargs="+", required=True, help="ASN XML file(s)")
    parser.add_argument("--shipping", help="UPS shipping label PDF (image-based OK)")
    parser.add_argument("--out",      required=True, help="Output PDF path")
    parser.add_argument("--dpi",      type=int, default=300, help="OCR DPI (default 300)")
    parser.add_argument(
        "--asn-order",
        action="store_true",
        help="Arrange matched document groups in ASN XML order instead of shipping-PDF order",
    )
    args = parser.parse_args(argv)

    run_pipeline(
        xml_paths         = args.xml,
        out_pdf           = args.out,
        shipping_pdf_path = args.shipping,
        ocr_dpi           = args.dpi,
        group_by_shipping_pdf = not args.asn_order,
    )


if __name__ == "__main__":
    main()
