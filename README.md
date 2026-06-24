# Merged LabelKit

Single FastAPI app for Michaels + KeHE label workflows, served with one frontend.

## 1) What this app does

This app processes EDI 856 ASN XML and generates print-ready PDF outputs for two workflows:

- Michaels (XML + shipping-label PDF matching)
- KeHE (XML-first label/document generation and editing)

## 2) Michaels workflow

- Upload ASN XML and shipping-label PDF files.
- Backend matches label pages to XML pack records.
- Output is a combined PDF and match report.
- Main endpoint: `POST /generate/michaels`

## 3) KeHE workflow

- Upload KeHE ASN XML (no shipping-label PDF required for GS1 flow).
- Generates and supports editing for:
  - GS1 Labels
  - Pallet Label
  - Master Packing List
  - Pack Labels
- Main endpoint: `POST /generate/kehe`

KeHE note for uploads:
**Upload multiple XML files only when multiple POs are being shipped together in the same shipment. Otherwise, upload a single XML file for the individual PO.**

## 4) Local run steps

From repo root:

```powershell
Set-Location ".\frankenstein_project"
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 9000 --reload
```

Open: `http://127.0.0.1:9000`

## 5) Docker run steps

From repo root:

```powershell
docker build -t merged-labelkit:latest .
docker run --rm -p 9000:9000 --name merged-labelkit merged-labelkit:latest
```

Open: `http://127.0.0.1:9000`

## 6) Zoho Catalyst deploy steps

Project: `27327000000040032`  
AppSail name: `merged-labelkit`  
Expected URL: `https://mergedlabelkit.development.catalystappsail.com`

```powershell
catalyst project:use 27327000000040032
catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000
```

## 7) Current file structure

Main deployment structure:

- `Dockerfile`
- `.dockerignore`
- `.gitignore`
- `README.md`
- `frankenstein_project/catalyst.json`
- `frankenstein_project/requirements.txt`
- `frankenstein_project/server.py`
- `frankenstein_project/start.sh`
- `frankenstein_project/data/kehe_dc_directory.json`
- `frankenstein_project/data/kehe_product_master.json`
- `frankenstein_project/frontend/dist/index.html`
- `frankenstein_project/pipelines/kehe_pipeline.py`
- `frankenstein_project/pipelines/michaels_label_pipeline.py`

Optional folder that may exist but is not the main deployment path:

- `frankenstein_project/appsail-nodejs/`

## 8) KeHE functionality currently supported

- Pack Labels
- Master Packing List
- Pallet Label
- GS1 Labels
- editable previews
- DC Directory
- GTIN / Packaging Master Table
- Auto Palletize
- Reverse to XML Palletization
- palletization source display: XML / Auto Palletize / Manual / MPL
- unassigned / needs-review rows
- 2 placards per pallet

## 9) KeHE pipeline filename

The active KeHE pipeline file is:

- `frankenstein_project/pipelines/kehe_pipeline.py`

(`kehe_label_pipeline.py` is not used.)
