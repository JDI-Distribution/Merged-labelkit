"""Excel order template, matching review, and order-number ZIP generation."""
from __future__ import annotations

import copy
import json
import shutil
import tempfile
import threading
import time
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from labelkit.jobs import RESULT_JOBS, RESULT_JOBS_LOCK, create_result_job, update_result_job
from labelkit.order_workbook_io import workbook_bytes
from labelkit.order_workbook_review import field_review, public_fields
from labelkit.order_workbook_documents import apply_reviewed_documents
from labelkit.order_workbook_jobs import check_worker, check_numbers_worker, retry_numbers_worker, generate_worker, reference_snapshot, resolve_worker
from labelkit.runtime import _request_actor, _require_permission

router = APIRouter()
EXCEL_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def owner(request):
    actor = _request_actor(request)
    return actor.get('user_id') or actor.get('email') or actor.get('name') or 'local'


def owned_result(request, result_id, field, copy_result=True):
    job = RESULT_JOBS.get(str(result_id))
    if not job or job.get('workbook_owner') != owner(request):
        raise HTTPException(404, 'This order review expired or is not available to your account. Load the orders again.')
    if job.get('status') != 'complete' or field not in job:
        raise HTTPException(409, 'Wait for the order check to finish.')
    if field in {'order_workbook_state','order_workbook_prepared'}:
        job['review_until'] = time.time()+3600
    return copy.deepcopy(job[field]) if copy_result else job[field]


def launch(request, kit, worker, *args, input_data=None, input_name='uploaded-orders.xlsx'):
    root = Path(tempfile.mkdtemp(prefix='labelkit_order_excel_'))
    if input_data is not None:
        (root / input_name).write_bytes(input_data)
        args = (*args, root / input_name)
    result_id = create_result_job(root, kit)
    RESULT_JOBS[result_id]['workbook_owner'] = owner(request)
    try:
        threading.Thread(target=worker, args=(result_id, *args), daemon=True).start()
    except Exception:
        with RESULT_JOBS_LOCK:
            RESULT_JOBS.pop(result_id, None)
        shutil.rmtree(root)
        raise
    return JSONResponse(dict(result_id=result_id))


@router.get('/api/order-documents/excel/template')
def download_order_template(request: Request):
    _require_permission(request, 'view')
    return Response(workbook_bytes(**reference_snapshot(request)), media_type=EXCEL_TYPE,
                    headers={'Content-Disposition': 'attachment; filename="Bulk_Order_Processing_Template.xlsx"'})


@router.post('/api/order-documents/excel/export')
def export_order_inputs(request: Request, payload: dict):
    _require_permission(request, 'view')
    values = payload.get('sheets')
    if not isinstance(values, dict) or not isinstance(values.get('Orders'), list) or not isinstance(values.get('Order Lines'), list):
        raise HTTPException(400, 'Order inputs are required for export.')
    if len(values['Orders']) > 100 or len(values['Order Lines']) > 5000 or len(values.get('Labels', [])) > 10000:
        raise HTTPException(400, 'The order export is too large. Export at most 100 orders and 5,000 lines.')
    return Response(workbook_bytes(**reference_snapshot(request), values=values), media_type=EXCEL_TYPE,
                    headers={'Content-Disposition': 'attachment; filename="Order_Documents_Inputs.xlsx"'})


@router.post('/api/order-documents/excel/check')
async def check_order_upload(request: Request, file: UploadFile = File(...)):
    _require_permission(request, 'generate')
    if Path(file.filename or '').suffix.lower() != '.xlsx':
        raise HTTPException(400, 'Upload the .xlsx order template.')
    try:
        data = await file.read(50*1024*1024+1)
    finally:
        await file.close()
    if len(data) > 50*1024*1024:
        raise HTTPException(413, 'The order workbook exceeds 50 MB.')
    return launch(request, 'order_excel_check', check_worker, request, input_data=data)


@router.post('/api/order-documents/excel/resolve')
@router.post('/api/order-documents/batch/resolve')
def resolve_order_upload(request: Request, payload: dict):
    _require_permission(request, 'generate')
    state = owned_result(request, payload.get('result_id'), 'order_workbook_state')
    choices = payload.get('choices') or {}
    if not isinstance(choices, dict) or any(not isinstance(value, dict) for value in choices.values()):
        raise HTTPException(400, 'Choose a source for each order discrepancy.')
    data = Path(state['input_path']).read_bytes()
    def run(result_id, snapshot, decisions, path):
        snapshot['input_path'] = str(path)
        resolve_worker(result_id, snapshot, decisions)
    return launch(request, 'order_excel_review', run, state, choices, input_data=data, input_name=Path(state['input_path']).name)


@router.post('/api/order-documents/excel/fields')
@router.post('/api/order-documents/batch/fields')
def review_order_fields(request: Request, payload: dict):
    _require_permission(request, 'generate')
    state = owned_result(request, payload.get('result_id'), 'order_workbook_state', copy_result=False)
    order = str(payload.get('order_number') or '')
    if order not in state['entries'] or not isinstance(payload.get('choice', {}), dict):
        raise HTTPException(400, 'Select an order from this batch.')
    try:
        return JSONResponse(public_fields(field_review(state, order, payload.get('choice') or {})))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get('/api/order-documents/excel/reviewed-inputs')
@router.get('/api/order-documents/batch/reviewed-inputs')
def export_reviewed_inputs(request: Request, result_id: str):
    _require_permission(request, 'view')
    prepared = owned_result(request, result_id, 'order_workbook_prepared')
    if prepared.get('intake') == 'numbers':
        return Response(json.dumps(prepared['values'], indent=2, ensure_ascii=False), media_type='application/json',
                        headers={'Content-Disposition': 'attachment; filename="Reviewed_Order_Inputs.json"'})
    return Response(workbook_bytes(**prepared['references'], values=prepared['values']), media_type=EXCEL_TYPE,
                    headers={'Content-Disposition': 'attachment; filename="Reviewed_Order_Inputs.xlsx"'})


@router.post('/api/order-documents/excel/generate')
@router.post('/api/order-documents/batch/generate')
def generate_order_upload(request: Request, payload: dict):
    _require_permission(request, 'generate')
    prepared = owned_result(request, payload.get('result_id'), 'order_workbook_prepared')
    try:
        apply_reviewed_documents(prepared, payload.get('reviewed_documents'))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if any(row['errors'] for row in prepared['report']) or not prepared['documents']:
        raise HTTPException(409, 'Resolve blocking inputs or skip those orders before generating.')
    if any(row['warnings'] for row in prepared['report']) and payload.get('approve_warnings') is not True:
        raise HTTPException(409, 'Review and acknowledge the document warnings before generating.')
    # Copy the original before allocating another job, which may expire an old check.
    data = Path(prepared['input_path']).read_bytes()
    def run(result_id, snapshot, path):
        snapshot['input_path'] = str(path)
        generate_worker(result_id, snapshot)
    return launch(request, 'order_excel_zip', run, prepared, input_data=data, input_name=Path(prepared['input_path']).name)


@router.get('/api/order-documents/batch/documents')
def prepared_order_documents(request: Request, result_id: str):
    _require_permission(request, 'generate')
    prepared = owned_result(request, result_id, 'order_workbook_prepared')
    return dict(documents=prepared['documents'])


@router.get('/api/order-documents/batch/file')
def generated_order_file(request: Request, result_id: str, order_number: str, name: str):
    _require_permission(request, 'view')
    report = owned_result(request, result_id, 'report')
    row = next((row for row in report.get('orders', []) if row['order_number'] == order_number and row.get('status') == 'generated'), {})
    relative = next((path for path in row.get('files', []) if Path(path).name == name), None)
    if not relative:
        raise HTTPException(404, 'This order file is not available.')
    from labelkit.routes.generation import _result_pdf_response
    root = Path(RESULT_JOBS[result_id]['temp_dir']).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise HTTPException(404, 'This order file is not available.')
    return _result_pdf_response(result_id, path, filename=name, media_type='application/pdf')


@router.post('/api/order-documents/batch/check')
def check_order_numbers(request: Request, payload: dict):
    _require_permission(request, 'generate')
    from labelkit.order_batch_intake import parse_order_numbers
    try:
        orders = parse_order_numbers(payload.get('order_numbers'))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return launch(request, 'order_batch_check', check_numbers_worker, request, orders,
                  input_data=json.dumps(dict(order_numbers=orders)).encode('utf-8'), input_name='source-orders.json')


@router.post('/api/order-documents/batch/retry')
def retry_order_number(request: Request, payload: dict):
    _require_permission(request, 'generate')
    state = owned_result(request, payload.get('result_id'), 'order_workbook_state')
    order = str(payload.get('order_number') or '')
    if state.get('intake') != 'numbers' or order not in state['entries']:
        raise HTTPException(400, 'Select an order from this batch.')
    data = Path(state['input_path']).read_bytes()
    return launch(request, 'order_batch_retry', retry_numbers_worker, request, state, order,
                  input_data=data, input_name='source-orders.json')


@router.post('/api/order-documents/batch/references')
def refresh_order_references(request: Request, payload: dict):
    _require_permission(request, 'generate')
    state = owned_result(request, payload.get('result_id'), 'order_workbook_state')
    order = str(payload.get('order_number') or '')
    if state.get('intake') != 'numbers' or order not in state['entries']:
        raise HTTPException(400, 'Select an order from this review.')
    def run(result_id, snapshot, path):
        from labelkit.order_workbook_jobs import fail
        from labelkit.order_workbook_match import public_check
        try:
            snapshot['entries'][order]['references'] = reference_snapshot(request)
            snapshot['input_path'] = str(path)
            RESULT_JOBS[result_id]['order_workbook_state'] = snapshot
            update_result_job(result_id, status='complete', detail=f'Saved products and addresses refreshed for {order}. Other orders retain their snapshots.', report=public_check(snapshot))
        except Exception as exc:
            fail(result_id, exc)
    return launch(request, 'order_reference_refresh', run, state, input_data=Path(state['input_path']).read_bytes(), input_name='source-orders.json')


@router.post('/api/order-documents/batch/session')
def keep_order_review(request: Request, payload: dict):
    """Keep the two active snapshots available while many PDFs rotate through the result cache."""
    _require_permission(request, 'generate')
    hold, release = payload.get('result_ids') or [], payload.get('release_ids') or []
    if any(not isinstance(values,list) or len(values)>4 or any(not isinstance(value,str) for value in values) for values in [hold,release]):
        raise HTTPException(400, 'Select the active order review snapshots.')
    identity = owner(request)
    with RESULT_JOBS_LOCK:
        for result_id in hold+release:
            job = RESULT_JOBS.get(result_id)
            if job is None and result_id in release:
                continue
            if not job or job.get('workbook_owner') != identity or not any(field in job for field in ['order_workbook_state','order_workbook_prepared']):
                raise HTTPException(404, 'This order review expired. Load the orders again.')
        for result_id in hold:
            RESULT_JOBS[result_id]['review_until'] = time.time()+3600
        for result_id in release:
            if result_id not in hold and result_id in RESULT_JOBS:
                RESULT_JOBS[result_id]['review_until'] = 0
    return dict(retained=len(hold))
