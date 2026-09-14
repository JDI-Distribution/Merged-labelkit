"""Michaels shipping-label OCR and safe PDF-page extraction."""

from __future__ import annotations

import io
import re
from typing import Tuple

import pymupdf as fitz
import pytesseract
from PIL import Image
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from .common import PO_RE, STORE_RE, UPS_RE, _pdf2image_kwargs, _resolve_poppler_bin_dir, _resolve_tesseract_cmd
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


__all__ = [
    "_extract_page_identifiers",
    "_ocr_image",
    "_pdf2image_kwargs",
    "_resolve_poppler_bin_dir",
    "_resolve_tesseract_cmd",
    "_shipping_page_to_bytes",
]
