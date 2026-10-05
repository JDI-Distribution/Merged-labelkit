# LabelKit

LabelKit is JDI Distribution's internal document-production application for sales orders, packing lists, Ti-Hi plans, pallet labels, customer case-pack labels, Michaels DTS output, and KeHE ASN output.

The primary workflow is **Order Documents**. It loads one sales order and reuses the same reviewed data for labels, the Master Packing List, Ti-Hi, and pallet labels. Manual packing-list and manual-label workflows are available from the same page.

## Application map

```text
LabelKit
|-- Order Documents
|   |-- Generate With Order Number
|   |-- Create Packing List Without an Order
|   |-- Create Label Without an Order
|   `-- Saved Packing Lists
|-- Michaels DTS
|   `-- ASN XML + ShipStation PDF -> grouped print-ready PDF/ZIP
|-- KeHE
|   `-- ASN XML -> GS1, pack, pallet, MPL, and Ti-Hi documents
|-- Product Master
`-- Customer & Destination Directory
```

Legacy hashes remain compatible:

- `#mpl` opens Order Documents on Packing List & Ti-Hi.
- `#b2b` opens Order Documents on Customer Labels.
- `#partners` opens Order Documents on Customer Labels.

## How order documents work

1. Enter the Sales Order Number.
2. When the number is reused, select the correct Ecomdash order instance.
3. LabelKit matches incoming SKUs to Product Master level SKUs and resolves the customer and addresses.
4. Select the documents required for the run.
5. Review and edit label jobs, the packing list, Ti-Hi, or pallet labels.
6. Generate the selected production PDFs.

Product Master is authoritative for packaging hierarchy, label templates, GTINs, case quantities, dimensions, and weights. Missing data produces review warnings where output can still be generated safely.

## Runtime profiles

Runtime behavior is controlled by:

```text
frankenstein_project/labelkit_config.json
```

The recommended setting is:

```json
{
  "active_profile": "auto",
  "allow_environment_overrides": false
}
```

`auto` selects:

- `local` on a workstation: no authentication, local JSON/CSV data.
- `catalyst` in AppSail: embedded authentication, Catalyst Data Store, and the `orderdata` Zoho Analytics connection.

Production intentionally disables local JSON and browser-cache fallback.

## Important data sources

Local development uses:

- `data/mpl_product_master.json`
- `data/mpl_directory.json`
- `data/b2b_label_templates.json`
- `data/customer_workflows.json`
- ignored local order fixture `data/KeHE_Michaels_Storefront_Test_Data.csv`
- ignored runtime audit and MPL draft JSON files

Catalyst uses these Data Store tables:

- `mpl_product_master`
- `mpl_directory`
- `kehe_mpl_drafts`
- `kehe_audit_log`

Zoho Analytics access uses the Catalyst connection link name `orderdata`. OAuth tokens and secrets are not stored in this repository.

## Product Master model

A product configuration groups shared product identity with packaging-level rows.

```text
Product configuration
|-- Customer / storefront
|-- Product Group ID
|-- Display SKU and incoming UOM
|-- Description
|-- Customer item number
|-- Verification state
`-- Packaging levels
    |-- Each
    |-- Inner Pack (optional)
    `-- Case (optional)
```

Each packaging level may carry its own SKU, GTIN, barcode encoding, quantity, dimensions, label template, copies, and enabled state. Order quantities are converted according to the exact matched level SKU. Shared legacy SKUs default deterministically to Each and remain reviewable.

## Directory model

Each directory record stores one reusable address with one or more roles:

- Ship From
- Ship To
- Bill To

The default Bakell Ship From is applied automatically. Order-provided Ship To and Bill To addresses remain editable for the current run.

## Prerequisites

- Python 3.11
- Node.js and npm for browser tests
- Docker Desktop for image builds
- Zoho Catalyst CLI for deployment
- Poppler and Tesseract for a non-Docker Michaels run

The Docker image installs Poppler and Tesseract automatically.

## Run locally

From the repository root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
.\.venv\Scripts\python.exe -m pip install -r .\frankenstein_project\requirements.lock
Set-Location .\frankenstein_project
..\.venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 9000
```

Open `http://127.0.0.1:9000/#home`.

Use canonical hash routes only. Query-string cache busters such as `?verify=` and `?refresh=` are not required.

Health check:

```powershell
Invoke-RestMethod http://127.0.0.1:9000/health
```

The response includes the application version and Git revision when they were provided to the Docker build.

## Validation

### Python regression suite

```powershell
Set-Location .\frankenstein_project
$env:PYTHONDONTWRITEBYTECODE = "1"
..\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

### JavaScript unit tests

```powershell
node --test tests/test_b2b_order_jobs.cjs tests/test_operations_readiness.cjs
```

### Browser workflow tests

Run LabelKit on port 9000, then:

```powershell
npm ci
npm run test:e2e
```

### Deployment smoke tests

```powershell
..\.venv\Scripts\python.exe scripts\validate_deployment.py http://127.0.0.1:9000
```

For Catalyst:

```powershell
..\.venv\Scripts\python.exe scripts\validate_deployment.py `
  https://mergedlabelkit.development.catalystappsail.com `
  --production
```

The production smoke test is read-only. Authenticated document workflows must also be checked through the Catalyst application after deployment.

## Build the Docker image

Build from the repository root so `.dockerignore` is applied:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
$release = "2026.10.05-maintenance"
$gitSha = git rev-parse --short HEAD
docker build --pull `
  --build-arg APP_VERSION=$release `
  --build-arg GIT_SHA=$gitSha `
  -t "merged-labelkit:$release" `
  -t merged-labelkit:latest `
  .
```

Run the exact image locally:

```powershell
docker run --rm -p 9000:9000 --name merged-labelkit-local merged-labelkit:latest
```

In another terminal, run `Invoke-RestMethod http://127.0.0.1:9000/health`. The reported `version` and `git_sha` must match the intended release.

## Deploy to Zoho Catalyst

The Catalyst project is configured by `.catalystrc`. `frankenstein_project/catalyst.json` points AppSail to `docker://merged-labelkit:latest` on port 9000.

Deploy only an image already tested locally:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
catalyst project:use 27327000000040032
catalyst project:list
catalyst deploy appsail `
  --name merged-labelkit `
  --source docker://merged-labelkit:latest `
  --port 9000
```

Verify `https://mergedlabelkit.development.catalystappsail.com/health`, then validate authenticated access, order lookup, Product Master, Directory, saved MPL records, label generation, and PDF previews.

## Release sequence

Use this order so Git, Docker, and Catalyst describe the same source:

1. Commit the complete source being released.
2. Run Python, JavaScript, browser, and deployment checks.
3. Build the dated image and `latest` from that commit.
4. Run and verify the image locally.
5. Push the commit and release tag to GitHub.
6. Deploy the exact tested `latest` image to Catalyst Development.
7. Run cloud health and authenticated workflow checks.
8. Retain `latest`, the new dated release, and one known-good rollback image.

## Reference-data schema migrations

Product Master and Directory records use schema version 2. LabelKit continues
to read unversioned legacy rows, so application compatibility can be deployed
and verified before any production record is changed.

Use this sequence for reference-data migrations:

1. Deploy and validate the dual-reader application release.
2. Preview the local migration:

   ```powershell
   Set-Location .\frankenstein_project
   ..\.venv\Scripts\python.exe scripts\migrate_reference_schema_v2.py
   ```

3. Apply the local migration only when counts and duplicate checks are clean:

   ```powershell
   ..\.venv\Scripts\python.exe scripts\migrate_reference_schema_v2.py --apply
   ```

   The command writes timestamped rollback copies under
   `frankenstein_project/.local/migration-backups/` before replacing either
   JSON file. It preserves legacy fields during the rollback window.

Catalyst requires no schema-version migration. Its existing Product Master and
Directory business columns identify the current schema, while LabelKit's
compatibility reader continues accepting older field names. The Catalyst-managed
`ROWID`, `CREATORID`, `CREATEDTIME`, and `MODIFIEDTIME` columns remain unchanged
and provide record identity and audit timestamps; they are not application
schema markers. Do not add a `SCHEMA_VERSION` column or rewrite Catalyst rows
solely for versioning.

## Dependency updates

`requirements.txt` describes supported top-level dependency ranges. `requirements.lock` records the exact tested runtime dependency set used by Docker.

When dependencies are intentionally updated:

1. Update `requirements.txt`.
2. Resolve and test the complete environment.
3. Refresh exact versions in `requirements.lock`.
4. Run the full regression suite.
5. Build and test a new Docker image.

Do not update the lock file opportunistically during unrelated changes.

## Security and permissions

- Catalyst production requires embedded authentication.
- Caller-supplied role headers are ignored when authentication is required.
- Users may view and generate.
- Editors may modify shared tables and save MPL records.
- Administrators may delete saved MPL records and access diagnostics.
- Uploaded files and generated documents are held only for active jobs and bounded result retention.
- Product Master, Directory, drafts, and audit data use Catalyst Data Store in production.

## Repository structure

```text
.
|-- .catalystrc
|-- .dockerignore
|-- .gitattributes
|-- .gitignore
|-- Dockerfile
|-- README.md
`-- frankenstein_project
    |-- catalyst.json
    |-- labelkit_config.json
    |-- requirements.txt
    |-- requirements.lock
    |-- server.py
    |-- package.json
    |-- package-lock.json
    |-- playwright.config.cjs
    |-- data/
    |-- frontend/dist/
    |-- labelkit/
    |-- pipelines/
    |-- scripts/
    `-- tests/
```

Backend responsibilities:

- `labelkit/order_intake.py`: shared Analytics order matching and quantity conversion.
- `labelkit/reference_data.py`: Product Master and Directory normalization.
- `labelkit/draft_storage.py`: compact draft/version serialization.
- `labelkit/file_operations.py`: upload and PDF split/combine helpers.
- `labelkit/product_quality.py`: completeness and validation rules.
- `pipelines/michaels/`: Michaels parsing, OCR, matching, and rendering.
- `pipelines/kehe/`: KeHE parsing, enrichment, labels, MPL, and Ti-Hi.
- `pipelines/b2b_labels/`: production B2B label rendering.

Frontend responsibilities:

- `operations-workspace.js`: unified Order Documents orchestration.
- `b2b-workspace.js`: label selection, queue, editing, and generation.
- `document-editor.js`: packing-list and label review editors.
- `mpl-tihi.js`: palletization and Ti-Hi editing.
- `reference-data.js`: Product Master and Directory workspaces.
- `order-context.js`: shared customer and address resolution.
- `workflow-enhancements.js`: readiness, progress, summaries, and MPL productivity controls.

## Files that must not be committed

- `.venv/`
- `node_modules/`
- `__pycache__/` and Python bytecode
- Playwright results and reports
- local audit and MPL draft JSON files
- the local Analytics order fixture
- Catalyst local working directories
- temporary PDFs, uploads, and test artifacts

These files are ignored by Git and excluded from the Docker build context.

## Rollback

The preserved pre-cleanup baseline is available as:

```text
branch: backup/pre-cleanup-2026-10-05
tag:    pre-cleanup-2026-10-05
```

To restore a deployed release, build the selected tag into a dated image, verify it locally, retag it as `merged-labelkit:latest`, and redeploy that exact image through Catalyst AppSail.
