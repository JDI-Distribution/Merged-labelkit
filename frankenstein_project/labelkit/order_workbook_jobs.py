"""Matching, review and per-order ZIP workers using the existing result lifecycle."""
from __future__ import annotations

import copy
import csv
import io
import json
import re
import zipfile
from pathlib import Path

from labelkit.b2b_orders import _load_b2b_label_templates, _render_b2b_batch_pdf, _render_b2b_batch_zip
from labelkit.directory_store import _datastore_load_dc_directory, _shared_dc_directory_file_read
from labelkit.jobs import RESULT_JOBS, update_result_job
from labelkit.order_workbook_documents import build_order_documents
from labelkit.order_workbook_io import read_order_workbook, number
from labelkit.order_workbook_match import check_orders, public_check
from labelkit.order_workbook_review import field_review, resolve_fields
from labelkit.product_store import _datastore_load_product_master, _shared_product_master_file_read
from labelkit.runtime import ANALYTICS_CLIENT, LOGGER
from pipelines.b2b_labels import MAX_B2B_RENDER_PAGES, b2b_job_page_plan
from pipelines.kehe_pipeline import render_kehe_master_packing_list_pdf, render_kehe_pallet_label_pdf


def reference_snapshot(request):
    products = _datastore_load_product_master(request)
    directory = _datastore_load_dc_directory(request)
    return dict(products=products if products is not None else _shared_product_master_file_read(),
                directory=directory if directory is not None else _shared_dc_directory_file_read(),
                templates=_load_b2b_label_templates().get('templates', []))


def fail(result_id, exc):
    LOGGER.exception('Order workbook job failed: %s', result_id)
    update_result_job(result_id, status='error', detail=str(getattr(exc, 'detail', exc)))


def check_worker(result_id, request, path):
    try:
        orders = read_order_workbook(Path(path).read_bytes())
        refs = reference_snapshot(request)
        state = check_orders(request, orders, **refs, analytics_client=ANALYTICS_CLIENT,
                             progress=lambda message: update_result_job(result_id, detail=message))
        state['input_path'] = str(path)
        RESULT_JOBS[result_id]['order_workbook_state'] = state
        update_result_job(result_id, status='complete', detail='Matching complete. Review source discrepancies before processing.', report=public_check(state))
    except Exception as exc:
        fail(result_id, exc)


def check_numbers_worker(result_id, request, orders, path):
    try:
        refs = reference_snapshot(request)
        inputs = {order: dict(header=dict(order_number=order), lines=[], labels=[]) for order in orders}
        state = check_orders(request, inputs, **refs, analytics_client=ANALYTICS_CLIENT,
                             progress=lambda message: update_result_job(result_id, detail=message))
        state.update(intake='numbers', input_path=str(path))
        RESULT_JOBS[result_id]['order_workbook_state'] = state
        update_result_job(result_id, status='complete', detail='Orders loaded. Verify the matched values and complete missing details.', report=public_check(state))
    except Exception as exc:
        fail(result_id, exc)


def retry_numbers_worker(result_id, request, state, order, path):
    try:
        refs = {name: state[name] for name in ['products', 'directory', 'templates']}
        checked = check_orders(request, {order: state['entries'][order]['input']}, **refs, analytics_client=ANALYTICS_CLIENT)
        state['entries'][order] = checked['entries'][order]
        state['input_path'] = str(path)
        RESULT_JOBS[result_id]['order_workbook_state'] = state
        update_result_job(result_id, status='complete', detail=f'Order {order} checked again. Verify its current items.', report=public_check(state))
    except Exception as exc:
        fail(result_id, exc)


def resolve_worker(result_id, state, choices):
    try:
        documents, report, skipped = [], [], []
        values = {'Orders': [], 'Order Lines': [], 'Labels': []}
        for order, entry in state['entries'].items():
            update_result_job(result_id, detail=f'Validating order {order} and calculating its pallet plan…')
            try:
                if (choices.get(order) or {}).get('skip') is True:
                    skipped.append(order)
                    report.append(dict(order_number=order, source='skip', errors=[], warnings=[], skipped=True))
                    continue
                effective = field_review(state, order, choices.get(order) or {})['resolved']
                values['Orders'].append(copy.deepcopy(effective['header']))
                values['Order Lines'] += copy.deepcopy(effective['lines'])
                values['Labels'] += copy.deepcopy(effective['labels'])
                resolved = resolve_fields(state, order, choices.get(order) or {})
                document = build_order_documents(order, resolved, {**state, **(entry.get('references') or {})})
                documents.append(document)
                report.append({field: document[field] for field in ['order_number', 'source', 'record_id', 'line_count', 'pallet_count', 'errors', 'warnings', 'review']})
            except ValueError as exc:
                report.append(dict(order_number=order, errors=[str(exc)], warnings=[], source=(choices.get(order) or {}).get('source', '')))
        templates = {row['template_id']: row for row in state['templates']}
        pages = sum(b2b_job_page_plan(job, templates[job['template_id']])['pages'] for doc in documents if not doc['errors'] for job in doc['jobs'])
        pages += sum(number(label.get('copies'),'Pallet Label Copies',whole=True) or 1 for doc in documents if not doc['errors'] for label in (doc.get('pallet_labels') or {}).get('pallets', []))
        errors = sum(len(row['errors']) for row in report)
        if pages > 20000:
            report.append(dict(order_number='Batch', errors=['This batch exceeds 20,000 label pages. Split it into smaller batches.'], warnings=[]))
            errors += 1
        if not documents:
            errors += 1
            report.append(dict(order_number='Batch', errors=['Select at least one order to process.'], warnings=[]))
        if len(values['Order Lines']) > 5000:
            raise ValueError('Use at most 5,000 included items per batch.')
        RESULT_JOBS[result_id]['order_workbook_prepared'] = dict(documents=documents, skipped=skipped, order_numbers=list(state['entries']), intake=state.get('intake'), input_path=state['input_path'], report=report, values=values,
            references={name: state[name] for name in ['products','directory','templates']})
        update_result_job(result_id, status='complete', detail='Review complete. Resolve blocking inputs before generating.' if errors else 'Orders matched and calculated. Review the outputs and generate the ZIP.',
                          report=dict(phase='review', orders=report, error_count=errors, warning_count=sum(len(row['warnings']) for row in report),
                                      label_pages=pages, can_generate=errors == 0))
    except Exception as exc:
        fail(result_id, exc)


def generate_worker(result_id, prepared):
    root = Path(RESULT_JOBS[result_id]['temp_dir'])
    report, files, names = [], [], set()
    try:
        for index, doc in enumerate(prepared['documents'], 1):
            order = doc['order_number']
            safe = re.sub(r'[^a-zA-Z0-9._-]+', '_', order).strip('._')[:100] or str(index)
            folder = f'SO_{safe}'
            if folder in names:
                folder += f'_{index}'
            names.add(folder)
            dest = root / folder
            dest.mkdir()
            order_files = []
            update_result_job(result_id, detail=f'Generating order {index} of {len(prepared["documents"])}: {order}')
            try:
                # Keep each render bounded; the ZIP contains separate print-ready PDFs.
                for offset in range(0, len(doc['jobs']), 100):
                    jobs = doc['jobs'][offset:offset+100]
                    templates = {row['template_id']: row for row in _load_b2b_label_templates()['templates']}
                    pages = sum(b2b_job_page_plan(job, templates[job['template_id']])['pages'] for job in jobs)
                    if pages > MAX_B2B_RENDER_PAGES:
                        data, _, _, _ = _render_b2b_batch_zip(jobs, f'Labels_{offset//100+1:03}')
                        with zipfile.ZipFile(io.BytesIO(data)) as archive:
                            for part in archive.namelist():
                                name = Path(part).name
                                if name.lower().endswith('.pdf'):
                                    path = dest / name
                                    path.write_bytes(archive.read(part))
                                    order_files.append(path)
                    else:
                        data, _, _ = _render_b2b_batch_pdf(jobs)
                        path = dest / ('Labels.pdf' if len(doc['jobs']) <= 100 else f'Labels_{offset//100+1:03}.pdf')
                        path.write_bytes(data)
                        order_files.append(path)
                if doc['packing_list']:
                    path = dest / 'Packing_List_and_TiHi.pdf'
                    doc['packing_list']['review_status'] = 'APPROVED'
                    for mpl in doc['packing_list']['packing_lists']:
                        mpl['review_status'] = 'APPROVED'
                    render_kehe_master_packing_list_pdf(doc['packing_list'], path)
                    order_files.append(path)
                if doc['pallet_labels']:
                    path = dest / 'Pallet_Labels.pdf'
                    render_kehe_pallet_label_pdf(doc['pallet_labels'], path)
                    order_files.append(path)
                if not order_files or any(not path.is_file() or path.stat().st_size == 0 for path in order_files):
                    raise ValueError('No complete document files were produced for this order.')
                files.extend(order_files)
                report.append(dict(order_number=order, source=doc['source'], record_id=doc['record_id'], status='generated',
                                   files=[str(path.relative_to(root)).replace('\\', '/') for path in order_files], warnings=doc['warnings'], error='', decisions=doc['decisions']))
            except Exception as exc:
                LOGGER.exception('Workbook order %s failed', order)
                report.append(dict(order_number=order, source=doc['source'], status='failed', files=[], warnings=doc['warnings'], error=str(exc), decisions=doc['decisions']))
        report += [dict(order_number=order, status='skipped', files=[], source='skip', error='', warnings=[]) for order in prepared['skipped']]
        source_order = {order: index for index, order in enumerate(prepared.get('order_numbers') or [row['order_number'] for row in prepared['values']['Orders']])}
        report.sort(key=lambda row: source_order.get(row['order_number'], len(source_order)))
        summary = dict(phase='finished', orders=report, generated=sum(row['status'] == 'generated' for row in report),
                       failed=sum(row['status'] == 'failed' for row in report), skipped=len(prepared['skipped']))
        output = root / 'order_documents.zip'
        with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
            for path in files:
                archive.write(path, str(path.relative_to(root)).replace('\\', '/'))
            if prepared.get('intake') == 'numbers':
                archive.write(prepared['input_path'], 'Source_Order_Numbers.json')
                archive.writestr('Reviewed_Order_Inputs.json', json.dumps(prepared['values'], indent=2, ensure_ascii=False))
                archive.writestr('Reviewed_Document_Snapshots.json', json.dumps(prepared['documents'], ensure_ascii=False))
            else:
                archive.write(prepared['input_path'], 'Source_Order_Workbook.xlsx')
                from labelkit.order_workbook_io import workbook_bytes
                archive.writestr('Reviewed_Order_Inputs.xlsx', workbook_bytes(**prepared['references'], values=prepared['values']))
            archive.writestr('Processing_Report.json', json.dumps(summary, indent=2, ensure_ascii=False))
            stream = io.StringIO(newline='')
            writer = csv.writer(stream)
            writer.writerow(['Order Number', 'Status', 'Chosen Source', 'Analytics Record', 'Files', 'Warnings', 'Error'])
            for row in report:
                # Prevent a report cell from becoming a spreadsheet formula.
                values = [row.get('order_number'), row['status'], row['source'], row.get('record_id', ''), '; '.join(row['files']), '; '.join(row['warnings']), row['error']]
                writer.writerow(["'"+str(value) if str(value or '').startswith(('=', '+', '-', '@')) else value for value in values])
            archive.writestr('Processing_Report.csv', '\ufeff'+stream.getvalue())
        update_result_job(result_id, status='complete', detail=f'{summary["generated"]} order(s) generated; {summary["failed"]} failed; {summary["skipped"]} skipped.',
                          report=summary, output_path=str(output), output_filename='order_documents.zip', media_type='application/zip')
    except Exception as exc:
        fail(result_id, exc)
