"""Shared document checks and authoritative pallet calculations."""
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request

from labelkit.b2b_orders import _load_b2b_label_templates
from labelkit.document_rules import document_readiness, pallet_plan
from labelkit.product_quality import analyze_product_master_rows
from labelkit.runtime import _require_permission

router = APIRouter()


@router.post('/api/documents/readiness')
def check_readiness(request: Request, payload: Dict[str, Any]):
    _require_permission(request, 'view')
    if payload.get('kind') not in {'labels', 'masterPackingList', 'packLabels', 'palletLabel'} or not isinstance(payload.get('draft'), dict):
        raise HTTPException(400, 'A supported document kind and draft are required.')
    return document_readiness(payload['kind'], payload['draft'], _load_b2b_label_templates().get('templates', []))


@router.post('/api/documents/pallet-plan')
def calculate_pallet_plan(request: Request, payload: Dict[str, Any]):
    _require_permission(request, 'generate')
    if not isinstance(payload.get('mpl'), dict) or payload.get('action', 'plan') not in {'plan', 'auto', 'weights'}:
        raise HTTPException(400, 'A packing list and supported calculation action are required.')
    return pallet_plan(payload['mpl'], payload.get('product_master') or [], payload.get('action', 'plan'))


@router.post('/api/mpl/product-master/validate')
def validate_products(request: Request, payload: Dict[str, Any]):
    _require_permission(request, 'view')
    rows = payload.get('rows')
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(400, 'rows must be a list of records.')
    return analyze_product_master_rows(rows)
