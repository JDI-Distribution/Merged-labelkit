"""B2B and partner label routes."""

from __future__ import annotations

import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from labelkit.b2b_orders import (
    _find_b2b_label_template,
    _load_b2b_label_templates,
    _render_b2b_batch_pdf,
    _render_b2b_batch_zip,
    _resolve_b2b_order_customer,
)
from labelkit.order_intake import (
    _analytics_order_details,
    _analytics_source_metadata,
    _b2b_analytics_order_items_for_products,
    _partner_customer_id_from_order,
    _select_analytics_order_instance,
    _validated_sales_order_number,
)
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.runtime import ANALYTICS_CLIENT, CUSTOMER_WORKFLOWS, _require_permission
from pipelines.b2b_labels import MAX_B2B_RENDER_PAGES, render_b2b_label_pdf


router = APIRouter()


@router.get("/api/b2b/label-templates")
async def get_b2b_label_templates(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    return JSONResponse(content=_load_b2b_label_templates())


@router.get("/api/customer-workflows")
async def get_customer_workflows(request: Request) -> JSONResponse:
    _require_permission(request, "view")
    return JSONResponse(content={"workflows": CUSTOMER_WORKFLOWS})


@router.post("/api/b2b/orders/lookup")
def lookup_b2b_order(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    _require_permission(request, "generate")
    sales_order_number = _validated_sales_order_number(payload)
    requested_ecomdash_id = str(payload.get("ecomdash_id") or "").strip() if isinstance(payload, dict) else ""

    analytics_rows = ANALYTICS_CLIENT.export_order_rows(request, sales_order_number)
    if not analytics_rows:
        raise HTTPException(status_code=404, detail=f"No rows were found for Sales Order Number '{sales_order_number}'.")

    product_rows = _datastore_load_product_master(request)
    if product_rows is None:
        product_rows = _shared_product_master_file_read()

    analytics_rows, selected_ecomdash_id, selection = _select_analytics_order_instance(
        analytics_rows,
        requested_ecomdash_id,
        sales_order_number,
        product_rows,
    )
    if selection is not None:
        return JSONResponse(content=selection)

    order_details = _analytics_order_details(analytics_rows)
    try:
        items = _b2b_analytics_order_items_for_products(analytics_rows, product_rows or [])
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    summary = {
        "analytics_rows": len(analytics_rows),
        "line_items": len(items),
        "matched_products": sum(1 for item in items if item.get("match_status") == "matched"),
        "unmatched_products": sum(1 for item in items if item.get("match_status") == "unmatched"),
        "ambiguous_products": sum(1 for item in items if item.get("match_status") == "ambiguous"),
        "defaulted_level_skus": sum(1 for item in items if item.get("needs_match_review")),
    }
    detected_customer = _resolve_b2b_order_customer(order_details, items)
    return JSONResponse(content={
        "sales_order_number": sales_order_number,
        "order_details": order_details,
        "detected_partner_customer": _partner_customer_id_from_order(order_details, items),
        "detected_customer": detected_customer,
        "source": _analytics_source_metadata(ecomdash_id=selected_ecomdash_id),
        "summary": summary,
        "items": items,
    })


@router.post("/api/order-documents/orders/lookup")
def lookup_order_documents(request: Request, payload: Dict[str, Any]) -> JSONResponse:
    """Load the canonical order context used by labels, MPL, Ti-Hi, and pallets.

    Keeping this as a thin alias preserves one matching/conversion implementation
    while the unified workspace replaces the older independent order lookups.
    """
    return lookup_b2b_order(request, payload)


@router.post("/api/b2b/render")
async def render_b2b_labels(request: Request, payload: Dict[str, Any]) -> Response:
    """Render an editable B2B label job without mutating Product Master.

    Verification is intentionally advisory for this endpoint.  An authorized
    generator may preview or print a configuration that still carries a review
    warning; the renderer only blocks missing/unsupported templates and an
    impossible carton range.
    """
    _require_permission(request, "generate")
    template = _find_b2b_label_template(payload.get("template_id"))
    if template is None:
        raise HTTPException(status_code=400, detail="Select a supported B2B label template.")
    try:
        result = render_b2b_label_pdf(payload, template, max_pages=MAX_B2B_RENDER_PAGES)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    warnings = result.get("warnings") or []
    safe_template = re.sub(r"[^A-Za-z0-9._-]+", "_", str(template.get("template_id") or "b2b_label"))
    headers = {
        "Content-Disposition": f'inline; filename="{safe_template.lower()}.pdf"',
        "X-B2B-Page-Count": str(result.get("pages") or 0),
        "X-B2B-Warning-Count": str(len(warnings)),
        "Access-Control-Expose-Headers": "X-B2B-Page-Count, X-B2B-Warning-Count",
    }
    return Response(content=result["pdf_bytes"], media_type="application/pdf", headers=headers)


@router.post("/api/b2b/render-batch")
async def render_b2b_label_batch(request: Request, payload: Dict[str, Any]) -> Response:
    """Render every selected label job for one loaded order into a single PDF."""
    _require_permission(request, "generate")
    try:
        pdf_bytes, pages, warnings = _render_b2b_batch_pdf(payload.get("jobs") or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers = {
        "Content-Disposition": 'inline; filename="b2b_order_labels.pdf"',
        "X-B2B-Page-Count": str(pages),
        "X-B2B-Warning-Count": str(len(warnings)),
        "Access-Control-Expose-Headers": "X-B2B-Page-Count, X-B2B-Warning-Count",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)


@router.post("/api/b2b/render-batch-archive")
async def render_b2b_label_batch_archive(request: Request, payload: Dict[str, Any]) -> Response:
    """Render a large order as a ZIP of page-limited PDFs."""
    _require_permission(request, "generate")
    order_number = re.sub(r"[^A-Za-z0-9_-]+", "_", str(payload.get("order_number") or "order")).strip("_") or "order"
    try:
        archive_bytes, pages, parts, warnings = _render_b2b_batch_zip(
            payload.get("jobs") or [],
            f"{order_number}_case_labels",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers = {
        "Content-Disposition": f'attachment; filename="{order_number}_case_labels.zip"',
        "X-B2B-Page-Count": str(pages),
        "X-B2B-Part-Count": str(parts),
        "X-B2B-Warning-Count": str(len(warnings)),
        "Access-Control-Expose-Headers": "X-B2B-Page-Count, X-B2B-Part-Count, X-B2B-Warning-Count",
    }
    return Response(content=archive_bytes, media_type="application/zip", headers=headers)


@router.post("/api/partner/render-labels")
async def render_partner_labels(request: Request, payload: Dict[str, Any]) -> Response:
    """Render every selected combined-customer order label in one PDF."""
    _require_permission(request, "generate")
    try:
        pdf_bytes, pages, warnings = _render_b2b_batch_pdf(payload.get("jobs") or [])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    headers = {
        "Content-Disposition": 'inline; filename="customer_case_pack_labels.pdf"',
        "X-B2B-Page-Count": str(pages),
        "X-B2B-Warning-Count": str(len(warnings)),
        "Access-Control-Expose-Headers": "X-B2B-Page-Count, X-B2B-Warning-Count",
    }
    return Response(content=pdf_bytes, media_type="application/pdf", headers=headers)
