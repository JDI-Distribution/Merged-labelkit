"""Package already-approved files from the original Order Documents workspace."""
import io
import json
import re
import shutil
import tempfile
import threading
import zipfile
from pathlib import Path

import pymupdf
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

from labelkit.jobs import RESULT_JOBS, create_result_job, update_result_job
from labelkit.runtime import _request_actor, _require_permission

router = APIRouter()
MAX_UPLOAD_BYTES = 150*1024*1024


def validate_manifest(value, file_count):
    numbers, orders, skipped = value.get('order_numbers'), value.get('orders'), value.get('skipped', [])
    if not isinstance(numbers,list) or not 1<=len(numbers)<=100 or any(not isinstance(number,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}',number) for number in numbers) or len(set(numbers))!=len(numbers):
        raise ValueError('Select 1 to 100 unique sales order numbers.')
    if not isinstance(skipped,list) or any(not isinstance(number,str) or number not in numbers for number in skipped) or len(set(skipped))!=len(skipped):
        raise ValueError('Skipped orders must belong to this order list.')
    expected=[number for number in numbers if number not in skipped]
    if not isinstance(orders,list) or not orders or any(not isinstance(order,dict) for order in orders) or [order.get('order_number') for order in orders]!=expected:
        raise ValueError('Provide approved documents for every included order, in entry order.')
    used=set()
    for order in orders:
        files=order.get('files')
        if not isinstance(files,list) or not 1<=len(files)<=3:
            raise ValueError(f'{order["order_number"]}: select the approved document files.')
        for file in files:
            if not isinstance(file,dict) or type(file.get('index')) is not int or not 0<=file['index']<file_count or file['index'] in used:
                raise ValueError('Each uploaded file must belong to exactly one selected order.')
            name=file.get('name')
            if not isinstance(name,str) or not 1<=len(name)<=200 or '/' in name or '\\' in name or Path(name).suffix.lower() not in {'.pdf','.zip'}:
                raise ValueError('Approved output names must identify a PDF or label ZIP.')
            used.add(file['index'])
    if used!=set(range(file_count)):
        raise ValueError('An uploaded file is not assigned to an order.')
    return value


def pdf_pages(data):
    with pymupdf.open(stream=data,filetype='pdf') as document:
        if document.needs_pass or document.page_count<1:
            raise ValueError('Approved PDFs must contain printable, unencrypted pages.')
        return document.page_count


def package_approved_orders(result_id, manifest):
    """Copy exact approved bytes; never call a renderer or pallet calculator."""
    root=Path(RESULT_JOBS[result_id]['temp_dir'])
    try:
        total_pages=0
        expanded_bytes=0
        report=[]
        folders=set()
        with zipfile.ZipFile(root/'approved_order_documents.zip','w',zipfile.ZIP_DEFLATED) as output:
            for ordinal,order in enumerate(manifest['orders'],1):
                number=order['order_number']
                update_result_job(result_id,detail=f'Packaging approved documents for {number} ({ordinal}/{len(manifest["orders"])})…')
                folder=f'SO_{number}'.rstrip(' .')
                if folder.casefold() in folders:folder+=f'_{ordinal}'
                folders.add(folder.casefold())
                names=set()
                files=[]
                for item in order['files']:
                    data=(root/f'upload-{item["index"]}').read_bytes()
                    if item['name'].lower().endswith('.pdf'):
                        pages=pdf_pages(data)
                        expanded_bytes+=len(data)
                    else:
                        pages=0
                        with zipfile.ZipFile(io.BytesIO(data)) as parts:
                            if not 1<=len(parts.infolist())<=1000:raise ValueError('A label ZIP must contain PDF parts.')
                            for part in parts.infolist():
                                if part.is_dir() or '/' in part.filename or '\\' in part.filename or not part.filename.lower().endswith('.pdf'):
                                    raise ValueError('A label ZIP may contain only flat PDF parts.')
                                expanded_bytes+=part.file_size
                                if expanded_bytes>MAX_UPLOAD_BYTES:raise ValueError('Expanded documents exceed 150 MB. Download fewer orders together.')
                                pages+=pdf_pages(parts.read(part))
                    total_pages+=pages
                    if total_pages>20000 or expanded_bytes>MAX_UPLOAD_BYTES:
                        raise ValueError('Download at most 20,000 pages and 150 MB of approved documents together.')
                    name=re.sub(r'[^A-Za-z0-9 ._()-]','_',item['name']).strip(' .')
                    if name.casefold() in names:name=f'{len(names)+1}_{name}'
                    names.add(name.casefold())
                    output.writestr(f'{folder}/{name}',data)
                    files.append(dict(name=f'{folder}/{name}',pages=pages))
                report.append(dict(order_number=number,record_id=order.get('record_id',''),status='approved',files=files))
            report += [dict(order_number=number,status='skipped',files=[]) for number in manifest.get('skipped',[])]
            sequence={number:index for index,number in enumerate(manifest['order_numbers'])}
            report.sort(key=lambda row:sequence[row['order_number']])
            output.writestr('Processing_Report.json',json.dumps(dict(orders=report,pages=total_pages),indent=2))
            output.writestr('Reviewed_Order_Inputs.json',json.dumps(manifest,indent=2,ensure_ascii=False))
        update_result_job(result_id,status='complete',detail='Approved documents packaged without recalculation.',output_path=str(root/'approved_order_documents.zip'),output_filename='approved_order_documents.zip',media_type='application/zip',report=dict(orders=report,pages=total_pages))
    except Exception as error:
        update_result_job(result_id,status='error',detail=f'Approved document archive failed: {error}')


@router.post('/api/order-documents/archive')
async def archive_orders(request: Request, manifest: str=Form(...), files: list[UploadFile]=File(...)):
    _require_permission(request,'generate')
    root=None
    try:
        if len(manifest.encode('utf-8'))>10*1024*1024 or len(files)>300:
            raise ValueError('The approved order archive is too large.')
        value=json.loads(manifest)
        if not isinstance(value,dict):raise ValueError('Order archive details are required.')
        validate_manifest(value,len(files))
        root=Path(tempfile.mkdtemp(prefix='labelkit_approved_orders_'))
        total=0
        for index,file in enumerate(files):
            with (root/f'upload-{index}').open('wb') as destination:
                while chunk:=await file.read(1024*1024):
                    total+=len(chunk)
                    if total>MAX_UPLOAD_BYTES:raise ValueError('Download at most 150 MB of approved documents together.')
                    destination.write(chunk)
        result_id=create_result_job(root,'approved_orders')
        actor=_request_actor(request)
        RESULT_JOBS[result_id]['owner']=actor.get('user_id') or actor.get('email') or actor.get('name') or 'local'
        try:threading.Thread(target=package_approved_orders,args=(result_id,value),daemon=True).start()
        except Exception:
            update_result_job(result_id,status='error',detail='The archive job could not start.')
            raise
        return dict(result_id=result_id)
    except (ValueError,json.JSONDecodeError) as error:
        if root:shutil.rmtree(root,ignore_errors=True)
        raise HTTPException(400,str(error)) from error
    finally:
        for file in files:await file.close()
