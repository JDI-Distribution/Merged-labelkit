"""Michaels ASN XML parsing."""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

from .common import Address, Item, Order, Pack, UPS_RE
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


__all__ = ["_parse_shipment_group", "parse_asn"]
