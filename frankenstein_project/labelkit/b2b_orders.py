"""B2B label templates, customer resolution, and batch rendering helpers."""

from __future__ import annotations

import io
import json
import re
import zipfile
from typing import Any, Dict, List, Optional

import pymupdf as fitz

from labelkit.order_intake import _partner_customer_id_from_text
from labelkit.runtime import B2B_LABEL_TEMPLATES_FILE, CUSTOMER_WORKFLOWS
from pipelines.b2b_labels import MAX_B2B_RENDER_PAGES, b2b_job_page_plan, render_b2b_label_pdf


def _load_b2b_label_templates() -> Dict[str, Any]:
    try:
        if not B2B_LABEL_TEMPLATES_FILE.exists():
            return {"templates": []}
        data = json.loads(B2B_LABEL_TEMPLATES_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("templates"), list):
            return data
    except Exception:
        pass
    return {"templates": []}


def _find_b2b_label_template(template_id: Any) -> Optional[Dict[str, Any]]:
    wanted = str(template_id or "").strip().lower()
    if not wanted:
        return None
    for template in _load_b2b_label_templates().get("templates", []):
        if not isinstance(template, dict):
            continue
        if str(template.get("template_id") or "").strip().lower() == wanted:
            return template
    return None


def _canonical_b2b_customer_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def _match_known_b2b_customer(value: Any, customers: List[str]) -> str:
    """Resolve free-form order text to the exact customer name used by LabelKit."""
    signal = _canonical_b2b_customer_text(value)
    if not signal:
        return ""
    compact_signal = signal.replace(" ", "")
    matches: List[tuple[int, str]] = []
    for customer in customers:
        normalized = _canonical_b2b_customer_text(customer)
        compact = normalized.replace(" ", "")
        if not compact:
            continue
        if signal == normalized:
            matches.append((1000 + len(compact), customer))
        elif f" {normalized} " in f" {signal} ":
            matches.append((700 + len(compact), customer))
        elif len(compact) >= 5 and compact in compact_signal:
            matches.append((400 + len(compact), customer))
    return max(matches, default=(0, ""))[1]


def _resolve_b2b_order_customer(order_details: Dict[str, Any], items: List[Dict[str, Any]]) -> Dict[str, str]:
    """Return one canonical B2B customer and explain which order signal resolved it."""
    details = order_details if isinstance(order_details, dict) else {}
    templates = _load_b2b_label_templates().get("templates", [])
    known_customers = sorted({
        str(template.get("customer") or "").strip()
        for template in templates
        if isinstance(template, dict) and str(template.get("customer") or "").strip()
    })
    matched_storefronts = sorted({
        str(item.get("product", {}).get("storefront") or "").strip()
        for item in items
        if isinstance(item, dict)
        and item.get("match_status") == "matched"
        and isinstance(item.get("product"), dict)
        and str(item.get("product", {}).get("storefront") or "").strip()
    })
    known_customers = sorted(set(known_customers + matched_storefronts))

    for field in ("email_id", "email"):
        signal = str(details.get(field) or "").strip()
        partner_id = _partner_customer_id_from_text(signal)
        if partner_id:
            workflow = next((row for row in CUSTOMER_WORKFLOWS if row.get("id") == partner_id), {})
            if workflow.get("label"):
                return {"name": str(workflow["label"]), "source": "email", "confidence": "exact", "signal": signal}
        customer = _match_known_b2b_customer(signal, known_customers)
        if customer:
            return {"name": customer, "source": "email", "confidence": "exact", "signal": signal}

    if len(matched_storefronts) == 1:
        return {
            "name": matched_storefronts[0],
            "source": "product_master",
            "confidence": "exact",
            "signal": matched_storefronts[0],
        }

    for field in ("storefront", "billing_customer_name", "ship_to_name", "supplier"):
        signal = str(details.get(field) or "").strip()
        partner_id = _partner_customer_id_from_text(signal)
        if partner_id:
            workflow = next((row for row in CUSTOMER_WORKFLOWS if row.get("id") == partner_id), {})
            if workflow.get("label"):
                return {"name": str(workflow["label"]), "source": field, "confidence": "strong", "signal": signal}
        customer = _match_known_b2b_customer(signal, known_customers)
        if customer:
            return {"name": customer, "source": field, "confidence": "strong", "signal": signal}

    fallback = str(
        details.get("billing_customer_name")
        or details.get("ship_to_name")
        or details.get("storefront")
        or (matched_storefronts[0] if matched_storefronts else "")
    ).strip()
    return {
        "name": fallback,
        "source": "order_fallback" if fallback else "unresolved",
        "confidence": "review",
        "signal": fallback,
    }


def _render_b2b_batch_pdf(jobs: List[Dict[str, Any]]) -> tuple[bytes, int, List[str]]:
    """Render selected B2B jobs into one mixed-size, print-ready PDF."""
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("At least one label job is required.")
    if len(jobs) > 100:
        raise ValueError("A label run can contain no more than 100 line items.")

    output = fitz.open()
    warnings: List[str] = []
    pages = 0
    try:
        for index, raw_job in enumerate(jobs, start=1):
            if not isinstance(raw_job, dict) or not raw_job.get("print_selected", True):
                continue
            template = _find_b2b_label_template(raw_job.get("template_id"))
            if template is None:
                raise ValueError(f"Label line {index} does not use a supported template.")
            result = render_b2b_label_pdf(raw_job, template, max_pages=MAX_B2B_RENDER_PAGES - pages)
            source = fitz.open(stream=result["pdf_bytes"], filetype="pdf")
            try:
                output.insert_pdf(source)
            finally:
                source.close()
            pages += int(result.get("pages") or 0)
            label = str(raw_job.get("product", {}).get("sku") or f"line {index}").strip()
            warnings.extend(f"{label}: {warning}" for warning in result.get("warnings") or [])
        if pages < 1:
            raise ValueError("Select at least one label line to print.")
        return output.tobytes(garbage=3, deflate=True), pages, warnings
    finally:
        output.close()


def _render_b2b_batch_zip(jobs: List[Dict[str, Any]], base_filename: str = "b2b_order_labels") -> tuple[bytes, int, int, List[str]]:
    """Render large order batches into ordered PDF parts, each within the page limit."""
    if not isinstance(jobs, list) or not jobs:
        raise ValueError("At least one label job is required.")
    if len(jobs) > 100:
        raise ValueError("A label run can contain no more than 100 line items.")

    requested_pages = 0
    for index, raw_job in enumerate(jobs, start=1):
        if not isinstance(raw_job, dict) or not raw_job.get("print_selected", True):
            continue
        template = _find_b2b_label_template(raw_job.get("template_id"))
        if template is None:
            raise ValueError(f"Label line {index} does not use a supported template.")
        requested_pages += b2b_job_page_plan(raw_job, template)["pages"]
    if requested_pages <= MAX_B2B_RENDER_PAGES:
        raise ValueError("This run fits in one PDF. Use the standard PDF render endpoint.")

    output_buffer = io.BytesIO()
    warnings: List[str] = []
    total_pages = 0
    part_count = 0
    part_document = fitz.open()

    def write_part(archive: zipfile.ZipFile) -> None:
        nonlocal part_document, part_count
        if part_document.page_count < 1:
            return
        part_count += 1
        part_name = f"{base_filename}_part_{part_count:03d}.pdf"
        archive.writestr(part_name, part_document.tobytes(garbage=3, deflate=True))
        part_document.close()
        part_document = fitz.open()

    try:
        with zipfile.ZipFile(output_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for index, raw_job in enumerate(jobs, start=1):
                if not isinstance(raw_job, dict) or not raw_job.get("print_selected", True):
                    continue
                template = _find_b2b_label_template(raw_job.get("template_id"))
                if template is None:
                    raise ValueError(f"Label line {index} does not use a supported template.")
                plan = b2b_job_page_plan(raw_job, template)
                carton_start = plan["carton_start"]
                carton_end = plan["carton_end"]
                copies = plan["copies"]
                run = raw_job.get("run") if isinstance(raw_job.get("run"), dict) else {}
                label = str(raw_job.get("product", {}).get("sku") or f"line {index}").strip()
                for carton in range(carton_start, carton_end + 1):
                    remaining_copies = copies
                    while remaining_copies:
                        room = MAX_B2B_RENDER_PAGES - part_document.page_count
                        copies_this_render = min(remaining_copies, room)
                        chunk_job = dict(raw_job)
                        chunk_job["run"] = {
                            **run,
                            "carton_start": str(carton),
                            "carton_end": str(carton),
                            "copies": str(copies_this_render),
                        }
                        result = render_b2b_label_pdf(
                            chunk_job,
                            template,
                            max_pages=MAX_B2B_RENDER_PAGES,
                        )
                        source = fitz.open(stream=result["pdf_bytes"], filetype="pdf")
                        try:
                            part_document.insert_pdf(source)
                        finally:
                            source.close()
                        warnings.extend(f"{label}: {warning}" for warning in result.get("warnings") or [])
                        rendered = int(result.get("pages") or 0)
                        total_pages += rendered
                        remaining_copies -= rendered
                        if part_document.page_count == MAX_B2B_RENDER_PAGES:
                            write_part(archive)
            write_part(archive)
            if total_pages < 1:
                raise ValueError("Select at least one label line to print.")
        return output_buffer.getvalue(), total_pages, part_count, warnings
    finally:
        part_document.close()
