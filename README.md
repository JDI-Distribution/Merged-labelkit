# Merged LabelKit

Merged LabelKit is a FastAPI web app for print-ready label and packing-list workflows.

- Michaels DTS: match ASN XML to ShipStation shipping-label PDFs, generate one combined PDF, and review/export the match report.
- KeHE GS1: upload KeHE ASN XML, manage reference tables, preview/edit outputs, and generate GS1 labels, pack labels, pallet labels, master packing lists, and TI-HI pallet layouts.
- Packing List & Ti-Hi: standalone MPL/TI-HI workspace with its own Product Master and Directory tables, separate from KeHE after the first seed.

The app is served by `frankenstein_project/server.py`. The browser UI lives in `frankenstein_project/frontend/dist/`.

## Prerequisites

- Windows PowerShell.
- Python. Known working workstation path:
  `C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe`
- Node.js for frontend JavaScript syntax checks.
- Docker Desktop for `merged-labelkit:latest`.
- Zoho Catalyst CLI, logged in to the JDI account.
- Git remote:
  `https://github.com/JDI-Distribution/Merged-labelkit.git`

Useful paths:

```powershell
$repo = "C:\Users\JDI Employee\Downloads\merged_labelkit"
$app = "$repo\frankenstein_project"
```

## What The App Does

Landing page options:

- `Michaels DTS`
- `KeHE GS1`
- `Packing List & Ti-Hi`

Shared backend routes:

- `GET /health`
- `POST /generate/{kit}`
- `GET /results/{result_id}/status`
- `GET /results/{result_id}/report`
- `GET /results/{result_id}/file`

KeHE and standalone MPL reference table routes:

- `GET/PUT /api/kehe/product-master`
- `GET/PUT /api/kehe/dc-directory`
- `GET/PUT /api/mpl/product-master`
- `GET/PUT /api/mpl/directory`
- `GET/POST/DELETE /api/kehe/mpl-drafts`
- `GET /api/kehe/audit-log`

## Michaels Workflow

1. Select `Michaels DTS`.
2. Upload one or more EDI 856 ASN XML files from Infocon.
3. Upload ShipStation shipping-label PDFs.
4. Click `Generate Labels`.
5. Review the `Matching Report`.
6. Use `Open Preview` or download the generated PDF.
7. Use `Export for Excel` for the match report CSV.

The matching report includes page, status, method, OCR tracking, OCR PO, OCR store, matched XML, and note. The report table is horizontally scrollable and wraps long values so data does not overlap.

## KeHE Workflow

Important XML note:

> Upload multiple XML files only when multiple POs are being shipped together in the same shipment. Otherwise, upload a single XML file for the individual PO.

1. Select `KeHE GS1`.
2. Upload KeHE ASN XML.
3. Review parsed XML data in `KeHE XML Data & Output Status`.
4. Use `GTIN / Packaging Master Table` and `DC Directory` as needed.
5. Generate or open:
   - `GS1 Labels Preview`
   - `Pallet Label Preview`
   - `Master Packing List Preview`
   - `Pack Labels Preview`
   - `Export for Excel`

KeHE functionality:

- GS1 Labels: XML-driven SSCC-18 / GS1-128 label output.
- Pack Labels: editable GTIN-14 / ITF-14 case and inner-pack labels.
- Master Packing List: editable MPL draft with line-item and pallet assignment.
- Pallet Label: editable pallet placard output.
- Editable previews for GS1 labels, pack labels, pallet labels, and master packing lists.
- DC Directory for DC/name, ship-from, delivery, billing, and match values.
- GTIN / Packaging Master Table for GTIN, description, packaging level, dimensions, weight, case quantity, label count, and SKU.
- Case rows feed MPL dropdowns and auto palletization automatically.
- Auto Palletize.
- Reverse to XML Palletization.
- Palletization source display: `XML`, `Auto Palletize`, `Manual`, or `MPL`.
- Unassigned and needs-review rows remain visible for user correction.
- Pallet labels render 2 placards per pallet.
- Saved MPL drafts can be reopened and deleted.
- Excel upload supports preview and confirm for KeHE Product Master and DC Directory.
- Change History shows supported table edits/imports.

## Packing List & Ti-Hi Workflow

`Packing List & Ti-Hi` is a standalone MPL workspace. It reuses the same editor and TI-HI renderer, but it has separate backend tables:

- `frankenstein_project/data/mpl_product_master.json`
- `frankenstein_project/data/mpl_directory.json`

The standalone tables seed from KeHE only when they do not exist yet. After that:

- KeHE Product Master changes do not modify the standalone MPL Product Master.
- KeHE DC Directory changes do not modify the standalone MPL Directory.
- Standalone MPL table edits do not modify KeHE tables.
- A storefront can be typed freely.
- MPL generation blocks mixed storefront SKUs in the same standalone MPL.

The standalone Product Master shows only rows that are usable by MPL. It does not show redundant `In MPL` or `Labels / Unit` columns.

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
- Delete saved drafts.
- Generate PDF from edited values.

TI-HI behavior:

- Constraints are pallet-specific.
- Constraints include max length, max width, max height, and max gross weight.
- Case orientation checks both `L x W` and `W x L`.
- Heavier SKUs stay lower; lighter SKUs stack above.
- Layers stay height-compatible.
- Height-zone palletization can fill supported areas at different heights.
- Alternating and mirrored layer patterns reduce repeated weak seams when feasible.
- The TI-HI preview snapshot is used by the generated MPL PDF.

`Generate PDF from Edited Values` uses the current editable draft, current reference tables, current pallet assignments, current pallet constraints, and current TI-HI preview state.

## Local Run

From repo root:

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

Expected response includes:

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
    "pipelines.kehe.tihi",
    "pipelines.michaels_label_pipeline",
    "pipelines.michaels.pipeline",
]
for mod in mods:
    importlib.import_module(mod)
print("python-import-ok", len(mods))
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
required = {
    "POST /generate/{kit}",
    "GET /api/kehe/mpl-drafts",
    "DELETE /api/kehe/mpl-drafts/{draft_id}",
    "POST /api/kehe/mpl-drafts/{draft_id}/delete",
    "GET /api/mpl/product-master",
    "PUT /api/mpl/product-master",
    "GET /api/mpl/directory",
    "PUT /api/mpl/directory",
}
missing = sorted(required - set(routes))
assert not missing, missing
print("server-route-smoke-ok", {"routes": len(routes), "missing": missing})
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
    |   |-- kehe_product_master.json
    |   |-- mpl_directory.json
    |   `-- mpl_product_master.json
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
- local-only runtime audit/draft files unless intentionally seeding them
- `merge_pipelines.py`
- `merge_script.py`
- `frankenstein_project/appsail-nodejs/`
- `frankenstein_project/pipelines/kehe_dc_directory.py`
- `frankenstein_project/pipelines/kehe_dc_directory.json`

The old `frankenstein_project/pipelines/__init__.py` is not required by the current imports.

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
