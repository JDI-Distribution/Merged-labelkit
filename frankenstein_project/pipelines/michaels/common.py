"""Michaels shared runtime setup, identifiers, and data models."""

from __future__ import annotations

import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

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
