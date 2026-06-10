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
- `frankenstein_project/pipelines/kehe_label_pipeline.py`
  - KeHE processing logic
- `frankenstein_project/frontend/dist/index.html`
  - Frontend UI (single page with 3 states: kit selection, workspace, preview)
- `frankenstein_project/requirements.txt`
  - Python dependencies
- `Dockerfile`
  - Container build

## Run locally (Windows PowerShell)

```powershell
Set-Location "frankenstein_project"
"C:/Users/JDI Employee/AppData/Local/Python/bin/python.exe" -m pip install -r requirements.txt
"C:/Users/JDI Employee/AppData/Local/Python/bin/python.exe" -m uvicorn server:app --host 0.0.0.0 --port 9000 --reload
```

Open:

- http://127.0.0.1:9000

## Run with Docker

From the repository root:

```bash
docker build -t label-kits .
docker run --rm -p 9000:9000 label-kits
```

Open:

- http://127.0.0.1:9000

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
- Node.js installed
- Catalyst CLI installed:

```bash
npm install -g zcatalyst-cli
```

### Deploy steps

1. Log in to Catalyst:

```bash
catalyst login
```

2. Build the Docker image from the repository root:

```bash
docker build -t merged-labelkit:latest .
```

3. Deploy from the `frankenstein_project` folder (uses `frankenstein_project/catalyst.json`):

```bash
cd frankenstein_project
catalyst deploy
```

If you want to deploy directly without saved config:

```bash
catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000
```

### Catalyst notes

- The app listens on port `9000`.
- AppSail memory can be adjusted in `frankenstein_project/catalyst.json`.
- The Docker image installs Tesseract OCR and Poppler utilities for PDF/OCR processing.
