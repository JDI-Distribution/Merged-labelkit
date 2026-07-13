# Merged LabelKit

Merged LabelKit is a FastAPI web app for print-ready label and packing-list workflows.

- Michaels DTS: match ASN XML to ShipStation shipping-label PDFs, generate one combined PDF, and review/export the match report.
- KeHE GS1: upload KeHE ASN XML, use read-only KeHE-filtered reference table views, preview/edit outputs, and generate GS1 labels, pack labels, pallet labels, master packing lists, and TI-HI pallet layouts.
- Packing List & Ti-Hi: standalone MPL/TI-HI workspace and the shared Product Master / Directory maintenance area for all storefronts.

The app is served by `frankenstein_project/server.py`. The browser UI lives in `frankenstein_project/frontend/dist/`.

## Single Environment Config

Use one file to switch between local development and Catalyst hosting:

```text
frankenstein_project/labelkit_config.json
```

Recommended setting:

```json
{
  "active_profile": "auto",
  "allow_environment_overrides": false
}
```

`active_profile` options:

- `auto`: local runs use the `local` profile; Catalyst AppSail runs use the `catalyst` profile.
- `local`: force local JSON fallback, no login gate.
- `catalyst`: force Catalyst Hosted Authentication and Catalyst Data Store.

For Catalyst, edit only the `profiles.catalyst` block in `labelkit_config.json`:

- Keep `auth_required` as `true`.
- Keep `allow_local_json_fallback` as `false`.
- Keep all `*_store` values as `datastore`.
- Keep the default same-origin Hosted Authentication URLs unless Catalyst changes the route:
  - `auth_login_url=/__catalyst/auth/login`
  - `auth_logout_url=/__catalyst/auth/login`
  - `auth_reset_url=/__catalyst/auth/login`
- The relative `/__catalyst/auth/login` route works from the current Catalyst host, so the same config works in Development and Production.
- The reset link opens the hosted login page, where Catalyst provides the forgot-password flow.

Because Docker copies this file into the AppSail image, rebuild and redeploy after changing Catalyst profile values.

For local development, edit only the `profiles.local` block if needed. Do not use `catalyst.json` as the runtime switch; it should only describe the AppSail deployment.

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

- `GET /api/kehe/product-master` read-only KeHE storefront view; `PUT` returns `405`
- `GET /api/kehe/dc-directory` read-only KeHE storefront view; `PUT` returns `405`
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
- DC Directory read-only view for `Storefront = KeHE` rows.
- GTIN / Packaging Master Table read-only view for `Storefront = KeHE` rows.
- KeHE generation only uses rows marked with `Storefront = KeHE`; missing storefront values default to `KeHE`.
- Product Master and Directory add/edit/delete/import operations are done from `Packing List & Ti-Hi` only.
- Case rows feed MPL dropdowns and auto palletization automatically.
- Auto Palletize.
- Reverse to XML Palletization.
- Palletization source display: `XML`, `Auto Palletize`, `Manual`, or `MPL`.
- Unassigned and needs-review rows remain visible for user correction.
- Pallet labels render 2 placards per pallet.
- Saved MPL drafts can be reopened and deleted.
- Change History shows supported table edits/imports.

## Packing List & Ti-Hi Workflow

`Packing List & Ti-Hi` is a standalone MPL workspace. It reuses the same editor and TI-HI renderer, and its Product Master / Directory tables are the shared source of truth:

- `frankenstein_project/data/mpl_product_master.json`
- `frankenstein_project/data/mpl_directory.json`

KeHE reads the same shared tables and filters to rows marked `Storefront = KeHE`. This keeps all storefront data in one place while letting KeHE remain isolated to KeHE rows:

- KeHE Product Master and DC Directory views are read-only.
- Packing List & Ti-Hi table edits can store rows for any storefront, including `KeHE`.
- Rows not marked `Storefront = KeHE` do not appear in the KeHE table views or KeHE generation.
- Mixed storefront SKUs in one standalone MPL are blocked.
- A storefront can be typed freely.

The standalone Product Master shows the full shared product table, including Case, Inner Pack, Each, Shipper Contents, Labels / Unit, SKU, and print-label preview. Create MPL still uses only Case rows for palletization.

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

## Catalyst Cloud Auth And Storage

Current production design:

- Hosted Authentication.
- Invite-only users controlled from Zoho/Catalyst.
- Roles: `Admin`, `Editor`, `User`.
- Catalyst Data Store is the production source of truth.
- Local JSON files are development fallback only.
- Saved MPL records can store generated PDFs in Catalyst File Store or Stratus only when the user clicks `Save MPL`; normal previews remain temporary.
- The frontend shows a login gate when `AUTH_REQUIRED=true` and no Catalyst user session is present.
- Backend endpoints enforce permissions; hiding buttons in the browser is not the security boundary.

Cloud source-of-truth rule:

- Deployed Catalyst reads `frankenstein_project/labelkit_config.json`.
- With `active_profile=auto`, AppSail selects the `catalyst` profile automatically.
- The `catalyst` profile must keep:
  - `app_env=production`
  - `auth_required=true`
  - `allow_local_json_fallback=false`
  - `allow_browser_local_cache=false`
  - `mpl_product_master_store=datastore`
  - `mpl_directory_store=datastore`
  - `mpl_drafts_store=datastore`
  - `audit_log_store=datastore`
- Hosted Authentication uses the same-origin Catalyst route `/__catalyst/auth/login`; no Development-vs-Production hostname needs to be committed.
- Sign out uses the Catalyst Web SDK and redirects back to `/__catalyst/auth/login`.
- `datastore` mode is strict. If Data Store is unavailable in deployed Catalyst, table reads/writes and saved MPL reads/writes fail with `Cloud data unavailable` instead of falling back to bundled JSON.
- `auto` mode is for local/development only; it can try Data Store first and then fall back to JSON.
- `file` mode is for local JSON-only testing.
- Do not merge browser `localStorage` or local JSON into cloud tables in production.
- In production, master-table browser `localStorage` cache/fallback is disabled.
- Keep `allow_environment_overrides=false` unless you intentionally want AppSail environment variables to override the single config file.

Catalyst tables:

- `mpl_product_master_table=mpl_product_master`
- `mpl_directory_table=mpl_directory`
- `mpl_drafts_table=kehe_mpl_drafts`
- `audit_log_table=kehe_audit_log`

Before deploying strict cloud mode, confirm the Catalyst Data Store tables above exist and are seeded. After deploy, the table APIs should report `source: "datastore"`; `source: "file"` means the deployment is not using cloud tables.

Verify the cloud tables exist before a strict deployment:

```powershell
catalyst project:use 27327000000040032
catalyst ds:export --table mpl_product_master
catalyst ds:export --table mpl_directory
catalyst ds:export --table kehe_mpl_drafts
catalyst ds:export --table kehe_audit_log
```

Audit fields:

- `AUDIT_ID`
- `EVENT_TIMESTAMP`
- `ACTOR_JSON`
- `TABLE_NAME`
- `ACTION`
- `RECORD_KEY`
- `RECORD_LABEL`
- `FIELD_NAME`
- `OLD_VALUE`
- `NEW_VALUE`
- `SOURCE`
- `BATCH_ID`
- `FILENAME`
- `IS_ACTIVE`

Role behavior:

- `Admin`: product/directory CRUD, saved MPL save/delete, audit view, and all generation workflows.
- `Editor`: product/directory CRUD, create/save MPL, audit view, and all generation workflows.
- `User`: preview/generate/open allowed documents only; no product/directory CRUD and no destructive saved MPL actions.

Operational setup checklist:

1. Configure Catalyst Hosted Authentication in the Catalyst console.
2. Keep Public Signup disabled for invite-only access.
3. Create Catalyst roles: `Admin`, `Editor`, `User`.
4. Add invited users and assign roles from Catalyst Authentication > User Management.
5. Keep the same-origin Hosted Auth route `/__catalyst/auth/login` in `frankenstein_project/labelkit_config.json`.
6. Confirm the four Data Store tables exist and are seeded.
7. Deploy with `active_profile=auto` or `active_profile=catalyst`; keep the `catalyst` profile on Data Store with local fallback disabled.
8. Verify `/api/auth/session` returns the signed-in user and role.
9. Verify table APIs return `source: "datastore"`.
10. Validate with one Admin, one Editor, and one User account before deploying broadly.

Cloud edge cases to test:

- Session expires while editing.
- User is disabled or role-changed while the app is open.
- Two users edit the same row.
- Excel/import batch partially fails.
- Storefront is changed from `KeHE` to another storefront and disappears from KeHE views.
- Data Store is unavailable.
- Saved MPL draft exists but its stored PDF/file is missing.
- Unauthorized direct API calls.

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
    |-- labelkit_config.json
    |-- requirements.txt
    |-- server.py
    |-- start.sh
    |-- data
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

Data table note:

- In local development, `mpl_product_master.json` and `mpl_directory.json` are the shared editable Product Master and Directory fallback sources.
- In Catalyst, `labelkit_config.json` points the app to Catalyst Data Store and disables local JSON fallback.
- KeHE uses rows from those shared tables where `Storefront = KeHE`.
- The old KeHE-only data files were removed so there is one maintained Product Master and one maintained Directory.

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
