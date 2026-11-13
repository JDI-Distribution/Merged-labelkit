# LabelKit

LabelKit is JDI Distribution's internal document-production application for sales orders, packing lists, Ti-Hi plans, pallet labels, customer case-pack labels, Michaels DTS output, and KeHE ASN output.

The primary workflow is **Order Documents**. It loads one or multiple sales orders and reuses each order's reviewed data for labels, the Master Packing List, Ti-Hi, and pallet labels. Manual packing-list and manual-label workflows are available from the same page.

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

Two reusable customer-label templates are available for any customer or SKU:
`GENERIC_1` without a barcode and `Generic_2barcode` with a required barcode.
Both use a landscape 6 × 4 inch sheet containing two repeated 3 × 4 inch panels.
Descriptions, PO numbers, carton sequences, and pack wording come from the
selected product and print job. Pack wording can be edited directly in the
label preview. Existing product assignments remain compatible with these
renamed templates.

## How order documents work

### Order Documents: one page for one or multiple orders

Enter one or more sales order numbers in **Load Orders**, separated by commas or
spaces. Duplicate numbers are ignored and entry order is retained. The original
Order Documents page loads the first order with its normal product matching,
default packing and automatic pallet calculation. Other orders load when selected,
so a long list does not delay reviewing the first order.

Use **Previous order**, **Next order**, or the order dropdown above the existing
workspace. Every order uses the same Customer Labels, Packing List & Ti-Hi,
Pallet Labels and Finished Files tabs. There is no bulk-review popup or separate
field-by-field wizard. Box customization, order-only SKU setup, optional Product
Master registration, directory selection, PDF preview and explicit approval use
the original controls.

Customize packing defaults to the selected line. **All SKUs in this order**
includes every line; **Across all included orders** applies to the matching SKU
in each order. Checking both includes every SKU in every non-skipped order.
Unloaded orders use the original load and Analytics-record selection workflow.
Each SKU retains its own demand and unit weight; shipping weights combine its
contents with the empty-box weight implied by the selected line's packed weight.
Missing unit weights block a bulk change until resolved. Calculations are staged
in memory and applied together; failure or cancellation restores the original
packing and approved files. A successful update requires fresh document approval.

Document tabs stay visible while scrolling. A fixed bottom bar mirrors the
existing Continue/Approve action and provides Previous/Next order controls for
multiple orders. It hides during document previews and editors. Orders with no
enabled label jobs can still open Customer Labels for an explanation and order-only
packing setup; explicitly configuring packing creates the missing label jobs
through the shared label-job builder without changing Product Master.

Each order retains its selected outputs, label templates and run fields, packing
settings, manual pallet edits, undo history, document approvals and finished PDFs
when switching. Matching data already loaded for an order is retained with that
order. Switching is blocked while a calculation, review, product setup or save is
in progress. Custom MPL and Custom Labels remain separate actions; returning to
the order list prompts you to save or download the custom document first.

When an order number has multiple Analytics records, use the original record
selector. Cancelling restores the previous order. A failed lookup affects that
order only: retry it, skip it, or start a manual packing list using the existing
editor. Loading different numbers offers inline choices to replace the current
order, add to the list, replace the entire list, or keep current work. Adding
ignores duplicates and preserves existing edits and approvals. A failed replacement
retains the previous work. A wrong number with no loaded work can be corrected
directly without a replacement prompt.

Preview and approve the selected documents through the existing workflow. Edited
inputs revoke the affected approvals. **Finished Files** shows the active order's
approved PDFs. **Download approved orders ZIP** requires every included order to
be ready and packages those exact approved files into a folder per order; it does
not regenerate documents or repalletize manual work. A JSON report records input
order, skipped orders, record IDs and file page counts. Limits are 100 orders,
20,000 approved pages and 150 MB per archive. Large label PDF bundles remain ZIPs
inside their order folder. Browser order sessions are temporary; save drafts or
download files before closing the page.

Order-document filenames use `Customer_OrderNumber_DocumentType.pdf` (or `.zip`
for large label bundles), consistently in Finished Files, preview downloads and
the combined archive. Spaces and unsafe filename characters become underscores;
order numbers retain leading zeros. Documents without an order use `Custom`.

Automatic palletization uses the shared backend planner: finish each SKU before
moving to the next; the next SKU may fill available space on the same layer and
pallet when weight, support, dimensions and Ti-Hi constraints permit. Repacking
preserves original demand and partial final boxes. Saved Case GTINs are not reused
automatically for a different repacked Case quantity.

The retired bulk popup, workbook intake endpoints, workbook template and separate
batch document-building path have been removed. Product Master and Directory
file imports remain available. Order-only edits do not update those shared tables.

Document readiness and Product Master quality checks come from the backend.
Pallet assignments, weights, and Ti-Hi geometry are calculated in Python; the
browser displays those results and does not fall back to a second layout engine.
Generation checks readiness, renders an isolated reviewed snapshot, and publishes
only if its inputs are still current. Shared order PO, shipping date, and addresses
feed labels, packing lists, and pallet labels; changing them revokes approvals.
Per-label lots, copies, templates, and carton ranges remain document settings.

Finished Files contains the current browser session's generated documents. Download
the PDFs to retain them after closing the page. Server generation accepts at most
two active jobs and retains up to 25 results; active downloads are protected from
cleanup. A server restart requires regenerating a temporary result. Saved Packing
Lists remain in the configured persistent store and can be reopened.

Damaged cloud drafts are listed as unreadable and preserved without blocking
healthy drafts from saving. They require recovery from a backup; the application
does not overwrite them with an empty draft. Saves exceeding the deployed
10,000-character draft column are rejected before any batch write.
Saved order snapshots retain every packaging level of the configurations used
by that order. Unrelated catalog entries are restored as choices when reopened,
while the order's saved configurations stay fixed for review.

Order customer detection is retained across the label and packing-list screens.
Automatic Directory selection excludes draft, blocked, inactive, and incomplete
addresses. Customer PO remains separate from the sales order; PO references in
order notes are shown for confirmation rather than silently used as the PO.
Each-only configurations require a shipping Case before claiming packing-list
or Ti-Hi readiness. Unassigned lines remain visible in partner packing lists.

Unmatched order lines offer **Set up for this order** for packing details without
registering the SKU in Product Master. Adding a reusable Product Master record is optional.
For authorized table editors, the existing product editor opens with
the customer, incoming SKU, description and available GTIN. **Save & update order**
saves the reusable configuration, rematches that line, and recalculates pallets.
Closing before saving discards the new configuration. Failed saves keep the form
open; failed order recalculations can be retried without creating another product.
Other order edits and custom packing are retained. Table-edit permission is required.

Product Master and Directory saves include the revision returned by their GET
endpoint. Missing revisions are rejected with HTTP 428 and stale revisions with
HTTP 409. Local workers serialize data access through a shared file lock; this
does not provide a transaction across separate Catalyst container instances.
Failed Data Store batches attempt to restore the prior snapshot and report a
save failure. Recovery can also fail during an outage; the error then explicitly
requires checking the table before retrying. Unreadable local files are preserved
and reported instead of being treated as empty data.

Product Master is authoritative for packaging hierarchy, label templates, GTINs, case quantities, dimensions, and weights. Missing data produces review warnings where output can still be generated safely.

Include the company or warehouse name in the editable **Ship To** address.
Partner PDF headers preserve the entered address line order and line breaks.
Address fields treat legacy `|` separators as line breaks in Directory imports,
saved drafts, previews, case labels, GS1 labels, pallet placards, and packing
lists. Address renderers never insert pipes between lines. Product descriptions
and internal matching keys keep their existing separators.
The **Balance Owed** column shows the entire order's shortage in the first item
row only (including **0** when fully shipped); subsequent item rows are blank.
The balance is calculated across the order from ordered minus shipped cases,
grouped by product so over-shipping another product does not hide a shortage.
Quantities split across pallets must represent each pallet's portion.
The pallet summary lists each pallet's dimensions, weight, and Ti-Hi, followed
by one **Total Weight** row containing the sum of all pallet weights.

Ti-Hi Settings retain the length, width, stack-height, and gross-weight limits.
Optional **Cases per layer (Ti)** and **Maximum layers (Hi)** fields constrain
the actual layout; leave them blank for automatic calculation. These are
per-order or per-pallet choices, with no customer-specific fixed Ti default.
Recalculate applies the settings and re-palletizes the order. A preview reports
any cases that cannot fit. The pallet summary and Ti-Hi use the same layout.
Summary dimensions show length × width × actual loaded height, including the
**Pallet base height**, which defaults to 6 inches. Max Height continues to
limit the product stack; the wooden base is added to the displayed height.

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

Product Master displays multiple configurations under their shared product SKU,
regardless of customer. A unique SKU remains a normal product entry. Use
**+ Add configuration** inside a product to create another configuration with
that SKU. Each retains its own customer, name, active state, GTINs, and packaging
hierarchy. The Configuration ID field appears only when another product shares
the SKU. It is generated automatically and can be replaced with a distinct,
nonempty ID; unique SKUs do not display the field. New
configurations start with blank GTINs and measurements. Michaels XML generation
continues to use the XML data without a new product-selection step.

Product exports contain one row per packaging level, including **Configuration
ID**. Repeat that ID on the Each, Inner Pack, and Case rows for one formulation;
use a different ID for another formulation even if the SKU is the same. The old
**Product SKU** import heading remains accepted as an alias. Imports merge by
customer, configuration ID, and level; omitted configurations are preserved.
Rows without IDs can match existing records by customer, SKU, equivalent GTIN,
and level. Different GTINs sharing the same SKU and packaging level are retained
as independent configurations for any customer, including Inner Pack and Case.
Ordinary legacy hierarchies are preserved. Retain exported IDs when importing a
full hierarchy so the app knows which packaging levels belong together.
Conflicting records for the same configuration and level are rejected.
CSV exports preserve GTIN text for application reimport; when editing in Excel,
import the GTIN column as Text to retain leading zeros.

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
node --test tests/test_b2b_order_jobs.cjs tests/test_operations_readiness.cjs tests/test_address_delimiters.cjs tests/test_pallet_overrides.cjs tests/test_save_races.cjs
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
$release = "2026.10.22-address-lines.2"
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

- `server.py`: FastAPI app, CORS/security middleware, static mount, and router registration.
- `labelkit/routes/`: feature routers (`system`, `reference`, `b2b`, `orders`, `drafts`, `generation`).
- `labelkit/runtime.py`: configuration, authentication glue, and Catalyst datastore access.
- `labelkit/jobs.py`: in-memory result jobs and background generation workers.
- `labelkit/product_store.py`, `directory_store.py`, `draft_store.py`, `audit_log.py`: persistence.
- `labelkit/reference_import.py`, `spreadsheets.py`: Excel/CSV import parsing and previews.
- `labelkit/b2b_orders.py`: B2B templates, customer resolution, and batch rendering helpers.
- `labelkit/analytics.py`: Zoho Analytics order lookup client.
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

Frontend script and stylesheet URLs include the deployed revision, in addition
to no-cache headers. An already open tab must be refreshed to run new code;
refresh after saving drafts or downloading files you need to keep.

## Rollback

The preserved pre-cleanup baseline is available as:

```text
branch: backup/pre-cleanup-2026-10-05
tag:    pre-cleanup-2026-10-05
```

To restore a deployed release, build the selected tag into a dated image, verify it locally, retag it as `merged-labelkit:latest`, and redeploy that exact image through Catalyst AppSail.
