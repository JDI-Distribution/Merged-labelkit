# Label Kits

Single FastAPI application for generating shipping labels from EDI 856 ASN XML.

## What this app does

This project provides two workflows in one UI:

- Michaels Label Kit
  - Inputs: ASN XML + shipping-label PDFs
  - Output: matched/combined print-ready PDF
- KeHE Label Kit
  - Inputs: ASN XML only
  - Output: one 4x6 GS1-128 SSCC label per carton/pack

## Project layout

- `frankenstein_project/server.py`
  - FastAPI app and API endpoints
- `frankenstein_project/pipelines/michaels_label_pipeline.py`
  - Michaels processing logic
- `frankenstein_project/pipelines/kehe_pipeline.py`
  - KeHE processing logic
- `frankenstein_project/frontend/dist/index.html`
  - Frontend UI (single page with 3 states: kit selection, workspace, preview)
- `frankenstein_project/requirements.txt`
  - Python dependencies
- `Dockerfile`
  - Container build

## Run locally

### Option 1: Local Python runtime (Windows PowerShell)

```powershell
Set-Location "frankenstein_project"
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 9000 --reload
```

Open http://127.0.0.1:9000

### Option 2: Local Docker runtime

From the repository root:

```powershell
docker build -t merged-labelkit:latest .
docker run --rm -p 9000:9000 --name merged-labelkit merged-labelkit:latest
```

Open http://127.0.0.1:9000

## API endpoints

- `POST /generate/michaels`
- `POST /generate/kehe`
- `GET /results/{result_id}/status`
- `GET /results/{result_id}/report`
- `GET /results/{result_id}/file`
- `GET /health`

## Notes

- KeHE workflow ignores shipping-label PDFs by design.
- Frontend and backend are served by the same FastAPI process.

## Deploy to Zoho Catalyst AppSail

### Prerequisites

- Docker Desktop installed and running
- Node.js 18+ installed
- Catalyst CLI installed:

```powershell
npm install -g zcatalyst-cli
```

### Deploy from local machine

1. Authenticate and select the correct project:

```powershell
catalyst login
catalyst project:list
```

2. Build the Docker image from the repository root:

```powershell
docker build -t merged-labelkit:latest .
```

3. Deploy from the `frankenstein_project` folder (uses `frankenstein_project\catalyst.json`):

```powershell
Set-Location "C:\path\to\Merged-labelkit"
catalyst deploy appsail --name merged-labelkit --build-path .\frankenstein_project --stack python_3_11 --command "./start.sh"
```

4. Verify deployment and capture URL:

```powershell
catalyst appsail:list
```

### Catalyst notes

- The container now binds to `X_ZOHO_CATALYST_LISTEN_PORT` (with `PORT`/`9000` fallback), matching AppSail runtime behavior.
- If you want custom runtime deployment from Docker instead, keep `frankenstein_project/catalyst.json` as `docker://merged-labelkit:latest` and run `catalyst deploy` from `frankenstein_project`.
- AppSail memory can be adjusted in `frankenstein_project/catalyst.json`.
- The Docker image installs Tesseract OCR and Poppler utilities for PDF/OCR processing.

## KeHE GTIN / Packaging Master Table persistence

The KeHE frontend now calls backend APIs for the GTIN / Packaging Master Table:

- `GET /api/kehe/product-master`
- `PUT /api/kehe/product-master`

The backend first tries Catalyst Data Store through the Python SDK. If it cannot initialize Data Store, it falls back to `frankenstein_project/data/kehe_product_master.json` so local Docker testing still works.

For production AppSail persistence, create a Catalyst Data Store table named `kehe_product_master` with these columns:

- `GTIN`
- `DESCRIPTION`
- `PACKAGING_LEVEL`
- `DIMENSIONS_IN`
- `WEIGHT_LBS`
- `SKU`
- `UNIQUE_KEY`
- `IS_ACTIVE`

The table name can be changed with the environment variable `KEHE_PRODUCT_MASTER_TABLE`. Set `KEHE_PRODUCT_MASTER_STORE=file` only for local testing.

## Seeded KeHE Product Master JSON

The app includes `frankenstein_project/data/kehe_product_master.json` with the initial GTIN / Packaging Master Table rows. In file fallback mode, `/api/kehe/product-master` reads this JSON. Later, the same row structure can be copied into Catalyst Data Store. Rows using the previous `Shipper Contents` label are stored as `Other` to match the frontend dropdown options.
