# Merged LabelKit

Single FastAPI app for Michaels and KeHE label workflows, served with one browser UI.

This README is the reusable maintenance workflow for local edits, validation, Git release, and Catalyst AppSail deploy.

## Prerequisites

- Windows PowerShell.
- Python. Known working path:
  `C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe`
- Node.js. Used for frontend script parsing validation.
- Zoho Catalyst CLI logged into the JDI account.
- Git remote:
  `https://github.com/JDI-Distribution/Merged-labelkit.git`

Repo paths:

```powershell
$repo = "C:\Users\JDI Employee\Downloads\merged_labelkit"
$app = "$repo\frankenstein_project"
```

Catalyst target:

- Project: `Label-kit`
- Project ID: `27327000000040032`
- Env: `Development`
- Env ID: `921277719`
- Domain: `label-kit-921277719.development`
- AppSail app: `merged-labelkit`
- AppSail source: `docker://merged-labelkit:latest`
- AppSail port: `9000`

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

Expected local signal:

- The KeHE and Michaels workflow tiles load.
- `/health` responds.
- KeHE upload, edit, preview, and PDF generation controls are visible after choosing KeHE.

## Current KeHE Workflow

Core outputs:

- GS1 Labels
- Pack Labels
- Master Packing List
- Pallet Label

Reference tables:

- `GTIN / Packaging Master Table`
  - Drives Pack Labels.
  - Drives Create MPL product dropdowns.
  - Supplies SKU, GTIN, description, packaging level, dimensions, weight, case quantity, and label counts.
- `DC Directory`
  - Drives Pallet Label previews.
  - Drives Create MPL dropdowns for `DC / Name`, `Ship From`, `Ship To`, and `Bill To`.

Manual Create MPL:

1. Open KeHE.
2. In `KeHE XML Data & Output Status`, click `Create MPL`.
3. Select `DC / Name`, `Ship From`, `Ship To`, and `Bill To` from DC Directory dropdowns.
4. Add line items as needed.
5. For each line item, select a product from the product dropdown.
6. Use `Add Pallet`, `Auto Palletize`, `Recalculate Weights`, and `Move Unassigned to Pallet 1` as needed.
7. Use `TI-Hi` on each pallet to inspect the pallet layout.
8. Click `Generate PDF from Edited Values`.

Manual Create MPL is one draft at a time and is not saved. It exists only in the current browser session until printed/generated.

## TI-HI Edit Flow

The TI-HI workflow is part of the Master Packing List editor.

1. Prepare or create an MPL.
2. In `Review & Edit Master Packing List`, assign line items to pallets.
3. Click `TI-Hi` on a pallet row.
4. The popup shows that pallet's TI-HI layout.
5. Edit that pallet's constraints:
   - `Max Length (in)`
   - `Max Width (in)`
   - `Max Height (in)`
   - `Max Gross (lbs)`
6. Click `Recalculate`.
7. Click `Close` when the layout looks right.
8. Click `Generate PDF from Edited Values`.

Important behavior:

- TI-HI constraints are pallet-specific when opened from a pallet.
- The PDF generation flow captures the current TI-HI visual snapshot before rendering.
- The generated MPL uses the edited pallet layout and the current TI-HI preview state.
- Heavier SKU groups are considered first for pallet layout, so heavier cases stay lower before lighter cases are stacked above.
- The simplified orientation logic uses `L x W` and `W x L` fit checks with the active pallet constraints.

## Generate PDF From Edited Values

`Generate PDF from Edited Values` posts the current editor draft to the backend render endpoint.

For MPL:

- Applies the current GTIN / Packaging Master Table before render.
- Finalizes pallet IDs and pallet weights.
- Captures TI-HI preview snapshots.
- Renders the MPL PDF.
- Adds TI-HI layout summary pages.
- Updates preview/download links.
- Updates downstream Pallet Label source to use the latest MPL palletization.

For Pack Labels:

- Uses edited label text, lot, best-before date, weight, case quantity, GTIN, and copy count.
- Uses ITF-14 / GTIN-14 barcode rendering in the PDF.
- Enforces the current two-side case-label copy rule for case/inner-pack labels.

For Pallet Labels:

- Uses the current edited pallet placard fields.
- Supports MPL-driven pallet groups or manually added pallet groups.

## Validation Commands

Run from repo root.

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
```

Frontend script parse:

```powershell
@'
const fs = require('fs');
const html = fs.readFileSync('frankenstein_project\\frontend\\dist\\index.html','utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
new Function(scripts.join('\n'));
console.log('frontend-script-parse-ok', scripts.length);
'@ | node -
```

Expected output:

```text
frontend-script-parse-ok <script-count>
```

Backend compile:

```powershell
& "C:\Users\JDI Employee\AppData\Local\Python\bin\python.exe" -m compileall ".\frankenstein_project\pipelines\kehe_pipeline.py"
```

Expected output:

```text
Compiling '.\frankenstein_project\pipelines\kehe_pipeline.py'...
```

No Python traceback means the compile check passed.

Optional quick check:

```powershell
git diff --check -- README.md frankenstein_project\frontend\dist\index.html frankenstein_project\pipelines\kehe_pipeline.py
```

Expected output:

```text
<no errors>
```

## Git Workflow

Inspect state:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
git --no-pager status --short
git --no-pager branch --show-current
git --no-pager remote -v
```

Stage only the required files:

```powershell
git add ".\README.md" ".\frankenstein_project\frontend\dist\index.html" ".\frankenstein_project\pipelines\kehe_pipeline.py"
```

Confirm staged files:

```powershell
git --no-pager diff --cached --stat
git --no-pager diff --cached --name-only
```

Commit:

```powershell
git commit -m "Clean TI-HI flow, refresh README workflow, and keep deploy path reusable"
```

Push current branch:

```powershell
$branch = git branch --show-current
git push -u origin $branch
```

Expected output:

```text
branch '<branch>' set up to track 'origin/<branch>'
```

or:

```text
Everything up-to-date
```

## Catalyst Deploy

Deploy from the AppSail folder, but explicitly select the `Label-kit` project first.

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit\frankenstein_project"
catalyst project:use 27327000000040032
catalyst appsail:list
catalyst deploy --only appsail
```

If this Catalyst CLI version does not accept `deploy --only appsail`, use:

```powershell
catalyst appsail:deploy --name merged-labelkit
```

Verify after deploy:

```powershell
catalyst appsail:list
```

Expected deploy target:

```text
Project: Label-kit
Project ID: 27327000000040032
Env: Development
AppSail: merged-labelkit
Domain: label-kit-921277719.development
```

## Quick Rollback / Troubleshooting

If validation fails before commit:

```powershell
git --no-pager diff -- README.md frankenstein_project\frontend\dist\index.html frankenstein_project\pipelines\kehe_pipeline.py
```

Fix the issue and rerun validation.

If a bad commit was pushed:

```powershell
git log --oneline -5
git revert <bad-commit-sha>
git push
```

Then redeploy Catalyst from `frankenstein_project`.

If Catalyst deploy targets the wrong project:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit\frankenstein_project"
catalyst project:use 27327000000040032
catalyst appsail:list
```

Confirm `Label-kit` and `merged-labelkit` before deploying again.

If the app does not load after deploy:

1. Run `catalyst appsail:list` and confirm `merged-labelkit` exists in `Label-kit`.
2. Confirm `catalyst.json` still points to `docker://merged-labelkit:latest` and port `9000`.
3. Re-run frontend parse and Python compile locally.
4. Redeploy AppSail.
5. If the deployed app is still unhealthy, revert the last commit and redeploy.

If MPL PDF generation is stale:

- Reopen `Review & Edit Master Packing List`.
- Reopen the relevant pallet `TI-Hi` popup.
- Click `Recalculate`.
- Close the popup.
- Click `Generate PDF from Edited Values`.

## Reusable Release Checklist

- [ ] Start at repo root: `C:\Users\JDI Employee\Downloads\merged_labelkit`
- [ ] Inspect `git status`, branch, and remote.
- [ ] Touch only required files.
- [ ] Keep behavior stable except the intended fix.
- [ ] Update README when workflow, validation, or deploy steps change.
- [ ] Run frontend script parse and see `frontend-script-parse-ok`.
- [ ] Run Python compile with no traceback.
- [ ] Run `git diff --check`.
- [ ] Stage only:
  - `README.md`
  - `frankenstein_project\frontend\dist\index.html`
  - `frankenstein_project\pipelines\kehe_pipeline.py`
- [ ] Commit with a clear workflow/fix message.
- [ ] Push current branch to GitHub.
- [ ] Deploy from `frankenstein_project`.
- [ ] Use Catalyst project `Label-kit` / `27327000000040032`.
- [ ] Verify `merged-labelkit` appears in `catalyst appsail:list`.
- [ ] Open the Development domain and smoke-test KeHE edit/render flow.

## Main Files

- `frankenstein_project\frontend\dist\index.html`
- `frankenstein_project\pipelines\kehe_pipeline.py`
- `frankenstein_project\server.py`
- `frankenstein_project\catalyst.json`
- `frankenstein_project\data\kehe_product_master.json`
- `frankenstein_project\data\kehe_dc_directory.json`

The active KeHE pipeline file is:

```text
frankenstein_project\pipelines\kehe_pipeline.py
```

`kehe_label_pipeline.py` is not used.
