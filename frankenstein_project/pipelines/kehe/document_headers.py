"""KeHE document header parsing and shipment extraction."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

from .asn_parser import (
    Pack,
    _extract_bsn_hl_groups,
    _first_ref,
    _get_elem,
    _parse_shipment_group,
    _scan_dates,
    _scan_ref_values,
    _segment_refs,
    find_kehe_dc,
    parse_asn,
)
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


__all__ = [
    "build_document_shipments",
    "parse_kehe_document_header",
    "parse_kehe_document_headers",
]
