"""KeHE ASN parsing, shared shipment models, and DC matching."""

from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET
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



def _normalize_sscc(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) == 20 and digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 17:
        digits = "0" + digits
    return digits

def _merge_duplicate_physical_packs(packs: List[Pack]) -> List[Pack]:
    """Merge repeated SSCC rows into one physical label/pallet while preserving POs/items."""
    merged: List[Pack] = []
    by_key: Dict[str, Pack] = {}
    item_sigs_by_key: Dict[str, set[Tuple[Any, ...]]] = {}
    for pack in packs:
        key = _normalize_sscc(pack.sscc) or (pack.sscc or "").strip()
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


__all__ = [
    "Address",
    "Item",
    "Order",
    "Pack",
    "_parse_shipment_group",
    "find_kehe_dc",
    "load_kehe_dc_directory",
    "parse_asn",
]
