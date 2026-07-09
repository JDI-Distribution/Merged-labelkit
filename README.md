# Merged LabelKit

Merged LabelKit is a FastAPI web app for two label workflows:

- Michaels DTS: match ASN XML to ShipStation shipping-label PDFs, then generate one print-ready output PDF and a match report.
- KeHE: upload ASN XML, manage reference tables, preview/edit documents, and generate GS1 labels, pack labels, master packing lists, pallet labels, and TI-HI pallet layouts.

The browser UI is served by `frankenstein_project/server.py` from `frankenstein_project/frontend/dist/`.

## Prerequisites

- Windows PowerShell.
- Python. Known working path on the current workstation:
  `C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe`
- Node.js, used for frontend JavaScript syntax checks.
- Docker Desktop, used to build `merged-labelkit:latest`.
- Zoho Catalyst CLI logged into the JDI account.
- Git remote:
  `https://github.com/JDI-Distribution/Merged-labelkit.git`

Useful paths:

```powershell
$repo = "C:\Users\JDI Employee\Downloads\merged_labelkit"
$app = "$repo\frankenstein_project"
```

## What The App Does

LabelKit has three entry points on the landing page:

- `Michaels DTS`: XML plus shipping-label PDF matching.
- `KeHE GS1`: XML-driven KeHE label and document generation.
- `Packing List & Ti-Hi`: standalone access to the KeHE MPL/TI-HI editor using the same Product Master and DC Directory data.

Shared backend routes:

- `GET /health`
- `POST /generate/{kit}`
- `GET /results/{result_id}/status`
- `GET /results/{result_id}/report`
- `GET /results/{result_id}/file`

The old plain `POST /generate` compatibility route is intentionally removed.

## Michaels Workflow

1. Open the app and select `Michaels DTS`.
2. Upload one or more EDI 856 ASN XML files from Infocon.
3. Upload ShipStation shipping-label PDFs.
4. Click `Generate Labels`.
5. Review the `Matching Report`.
6. Use `Open Preview` or download the generated PDF.
7. Use `Export for Excel` for the match report CSV.

The report table shows:

- Page
- Status
- Method
- OCR Tracking
- OCR PO
- OCR Store
- Matched XML
- Note

The table is horizontally scrollable and wraps long OCR/XML values so tracking numbers and notes do not overlap.

## KeHE Workflow

Important upload note:

> Upload multiple XML files only when multiple POs are being shipped together in the same shipment. Otherwise, upload a single XML file for the individual PO.

1. Open the app and select `KeHE GS1`.
2. Upload KeHE ASN XML.
3. Review parsed XML data in `KeHE XML Data & Output Status`.
4. Use reference tables as needed:
   - `GTIN / Packaging Master Table`
   - `DC Directory`
5. Generate or prepare outputs:
   - `GS1 Labels Preview`
   - `Pallet Label Preview`
   - `Master Packing List Preview`
   - `Pack Labels Preview`
   - `Export for Excel`

KeHE functionality:

- `GS1 Labels`: XML-only SSCC-18 / GS1-128 labels.
- `Pack Labels`: editable GTIN-14 / ITF-14 case and inner-pack labels.
- `Master Packing List`: editable MPL draft with line-item and pallet assignment.
- `Pallet Label`: editable pallet placard output.
- Editable previews for pallet labels, master packing lists, and pack labels before final PDF render.
- `GTIN / Packaging Master Table` for SKU, GTIN, descriptions, packaging level, dimensions, weights, case quantities, label counts, and whether an item is included in the packing list.
- `DC Directory` for DC/name, ship-from, delivery, billing, and matching values.
- `Auto Palletize` for case rows in the MPL editor.
- `Reverse to XML Palletization` to restore XML-derived pallet assignment.
- Palletization source display values:
  - `XML`
  - `Auto Palletize`
  - `Manual`
  - `MPL`
- Unassigned and needs-review rows remain visible for user correction.
- Pallet labels render two placards per pallet.
- Manual MPL creation is available from both KeHE and `Packing List & Ti-Hi`.
- Saved MPL drafts can be reopened through `Open Saved MPL`.
- Excel upload supports bulk update preview and confirm for Product Master and DC Directory.
- Change History shows audit entries for supported table edits/imports.

## Master Packing List And TI-HI

The MPL editor supports:

- Add pallet.
- Add line item.
- Drag line items between pallets.
- Auto palletize.
- Reverse to XML palletization.
- Recalculate weights.
- Move unassigned items to Pallet 1.
- Save and reopen drafts.
- Generate PDF from edited values.

TI-HI behavior:

- TI-HI constraints are pallet-specific.
- Pallet constraints include max length, max width, max height, and max gross weight.
- Heavier SKUs are considered first so heavier cases stay lower and lighter cases stack above.
- Case orientation checks both `L x W` and `W x L`.
- Alternating layers rotate for structure when supported by the layout.
- The visual preview is used by the generated MPL PDF.

`Generate PDF from Edited Values` uses the current editable draft, current Product Master rows, current pallet assignments, and current TI-HI preview state.

## Local Run

From the repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit\frankenstein_project"
& "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m uvicorn server:app --host 0.0.0.0 --port 9000 --reload
```

Open:

```text
http://127.0.0.1:9000
```

Health check:

```powershell
Invoke-WebRequest "http://127.0.0.1:9000/health" | Select-Object -ExpandProperty Content
```

Expected signal:

- `status` is `ok`.
- `frontend_found` is `true`.

## Docker Run

Build from repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
docker build -t merged-labelkit:latest .
```

Run locally:

```powershell
docker run --rm -p 9000:9000 --name merged-labelkit-local merged-labelkit:latest
```

Open:

```text
http://127.0.0.1:9000
```

The Dockerfile must keep this AppSail-compatible command:

```dockerfile
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${X_ZOHO_CATALYST_LISTEN_PORT:-${PORT:-9000}}"]
```

## Zoho Catalyst Deploy

Target:

- Project: `Label-kit`
- Project ID: `27327000000040032`
- Environment: `Development`
- Env ID: `921277719`
- AppSail name: `merged-labelkit`
- Source: `docker://merged-labelkit:latest`
- Port: `9000`
- URL: `https://mergedlabelkit.development.catalystappsail.com`

Deploy from repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
catalyst project:use 27327000000040032
docker build -t merged-labelkit:latest .
catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000
```

Verify:

```powershell
Invoke-WebRequest "https://mergedlabelkit.development.catalystappsail.com/health" | Select-Object -ExpandProperty Content
```

Expected health response:

```json
{"status":"ok"}
```

## Validation Commands

Run from repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
```

Python compile:

```powershell
& "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -m py_compile ".\frankenstein_project\server.py"
& "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -m py_compile ".\frankenstein_project\pipelines\kehe_pipeline.py"
& "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -m py_compile ".\frankenstein_project\pipelines\michaels_label_pipeline.py"
```

Frontend script parse:

```powershell
@'
const fs = require('fs');
const html = fs.readFileSync('frankenstein_project\\frontend\\dist\\index.html','utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(Boolean);
const app = fs.readFileSync('frankenstein_project\\frontend\\dist\\assets\\js\\app.js','utf8');
new Function(inlineScripts.join('\n'));
new Function(app);
console.log('frontend-script-parse-ok', inlineScripts.length + 1);
'@ | node -
```

Import smoke:

```powershell
@'
import importlib
mods = [
    "server",
    "pipelines.kehe_pipeline",
    "pipelines.kehe.common",
    "pipelines.michaels_label_pipeline",
    "pipelines.michaels.pipeline",
]
for mod in mods:
    importlib.import_module(mod)
print("python-app-imports-ok", len(mods))
'@ | & "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -
```

Route smoke:

```powershell
@'
import server
routes = sorted(
    f"{method} {route.path}"
    for route in server.app.routes
    for method in getattr(route, "methods", [])
    if method in {"GET", "POST", "PUT", "DELETE"}
)
assert "POST /generate" not in routes
assert "POST /generate/{kit}" in routes
assert "GET /api/kehe/mpl-drafts" in routes
assert "GET /api/kehe/audit-log" in routes
print("server-route-smoke-ok", {"routes": len(routes), "compat_generate_removed": True})
'@ | & "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -
```

## Git Workflow

Stay on `main`:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
git --no-pager branch --show-current
git --no-pager status --short
git --no-pager remote -v
```

Stage the cleaned app:

```powershell
git add -A
git --no-pager diff --cached --stat
git --no-pager diff --cached --name-status
```

Commit:

```powershell
git commit -m "Clean app source, refresh docs, and deploy current LabelKit"
```

Push:

```powershell
git push origin main
```

Confirm clean:

```powershell
git status --short
```

## Current File Structure

Tracked app source:

```text
.
|-- .catalystrc
|-- .dockerignore
|-- .gitignore
|-- Dockerfile
|-- README.md
`-- frankenstein_project
    |-- catalyst.json
    |-- requirements.txt
    |-- server.py
    |-- start.sh
    |-- data
    |   |-- kehe_dc_directory.json
    |   `-- kehe_product_master.json
    |-- frontend
    |   `-- dist
    |       |-- index.html
    |       `-- assets
    |           |-- css
    |           |   `-- app.css
    |           `-- js
    |               `-- app.js
    `-- pipelines
        |-- kehe_pipeline.py
        |-- michaels_label_pipeline.py
        |-- kehe
        |   |-- __init__.py
        |   |-- asn_parser.py
        |   |-- common.py
        |   |-- document_headers.py
        |   |-- gs1_labels.py
        |   |-- mpl.py
        |   |-- pack_labels.py
        |   |-- pallet_labels.py
        |   |-- product_master.py
        |   `-- tihi.py
        `-- michaels
            |-- __init__.py
            |-- asn_parser.py
            |-- common.py
            |-- matcher.py
            |-- ocr.py
            |-- pipeline.py
            `-- renderers.py
```

Correct KeHE wrapper filename:

```text
frankenstein_project/pipelines/kehe_pipeline.py
```

The wrapper keeps legacy imports working while implementation lives under `frankenstein_project/pipelines/kehe/`.

## Cleanup Rules

Do not commit:

- `.git/`
- `__pycache__/`
- `*.pyc`
- `check_frontend.js`
- temporary test files
- `merge_pipelines.py`
- `merge_script.py`
- `frankenstein_project/appsail-nodejs/`
- `frankenstein_project/pipelines/kehe_dc_directory.py`
- `frankenstein_project/pipelines/kehe_dc_directory.json`

The old `frankenstein_project/pipelines/__init__.py` was empty and is not required by the current imports.

## Quick Rollback / Troubleshooting

If validation fails before commit:

```powershell
git --no-pager diff
```

Fix the failing file and rerun validation.

If Docker build fails:

```powershell
docker build --no-cache -t merged-labelkit:latest .
```

If Catalyst deploy targets the wrong project:

```powershell
catalyst project:use 27327000000040032
catalyst project:list
```

If a bad commit was pushed:

```powershell
git log --oneline -5
git revert <bad-commit-sha>
git push origin main
docker build -t merged-labelkit:latest .
catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000
```

## Reusable Release Checklist

- [ ] Stay in `C:\Users\JDI Employee\Downloads\merged_labelkit`.
- [ ] Confirm branch is `main`.
- [ ] Confirm remote is `JDI-Distribution/Merged-labelkit`.
- [ ] Remove obsolete/local-only files.
- [ ] Keep current app source, including `frontend/dist/assets/`, `pipelines/kehe/`, and `pipelines/michaels/`.
- [ ] Update README if workflow, structure, validation, Docker, or deploy steps changed.
- [ ] Run Python compile checks.
- [ ] Run frontend script parse.
- [ ] Run import and route smoke checks.
- [ ] Build `docker build -t merged-labelkit:latest .`.
- [ ] Deploy with `catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000`.
- [ ] Health-check `https://mergedlabelkit.development.catalystappsail.com/health`.
- [ ] Commit on `main`.
- [ ] Push `origin main`.
- [ ] Confirm `git status --short` is clean.
