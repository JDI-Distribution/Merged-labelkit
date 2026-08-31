# Merged LabelKit

Merged LabelKit is a FastAPI web app for print-ready label and packing-list workflows.

- Michaels DTS: match ASN XML to ShipStation shipping-label PDFs, generate one combined PDF, and review/export the match report.
- KeHE GS1: upload KeHE ASN XML, use read-only KeHE-filtered reference table views, preview/edit outputs, and generate GS1 labels, pack labels, pallet labels, master packing lists, and TI-HI pallet layouts.
- Packing List & Ti-Hi: standalone MPL/TI-HI workspace and the shared Product Master / Directory maintenance area for all storefronts.
- B2B Case-Pack Labels: follow a customer-first configuration hierarchy, edit printed values directly on a live label canvas, complete technical product/barcode setup when needed, and render the production PDF for download or printing.

The app is served by `frankenstein_project/server.py`. The browser UI lives in `frankenstein_project/frontend/dist/`.

## How LabelKit Works

```text
Browser UI
   |
   v
FastAPI routes in server.py
   |-- Michaels pipeline ---- ASN XML + shipping-label PDF --> combined PDF + match report
   |-- KeHE pipeline -------- ASN XML + reference data ------> GS1/pack/pallet/MPL PDFs
   |-- Packing List & Ti-Hi - sales order + Product Master --> editable MPL + optional TI-HI
   `-- B2B labels ----------- sales order + product/template --> editable label canvas --> case-pack PDF
```

- The frontend is a bundled HTML/CSS/JavaScript application served by FastAPI; there is no separate frontend build server.
- `labelkit_config.json` selects the local or Catalyst runtime profile. `auto` uses local JSON/CSV sources on a workstation and Catalyst authentication, connections, and Data Store in AppSail.
- Local master data is stored under `frankenstein_project/data/`. Catalyst uses the configured Data Store tables and does not fall back to bundled JSON in strict cloud mode.
- Generated PDFs are prepared by the module-specific Python pipelines, exposed through the shared result endpoints, and previewed/downloaded by the browser. The B2B editable canvas mirrors the selected renderer, while Section 4 remains the authoritative production-PDF proof.
- Packing List and B2B order lookup use the field label `Sales Order Number`. Catalyst reads the Zoho Analytics order view through the `orderdata` connection.
- Missing Product Master data produces one short review warning instead of blocking output. Packing lists use the order SKU as Item Number, carry the order Product Name into Item Description, and use order-provided weight fields when present. Lines without safe case dimensions or case-pack data remain excluded from TI-HI.

## Release Order

Use this sequence for a reproducible release:

1. Run the regression and syntax checks.
2. Build and health-check `merged-labelkit:latest` locally.
3. Deploy that exact local image to the Catalyst Development AppSail.
4. Verify the cloud `/health` endpoint and authenticated application behavior.
5. Commit the validated source and push `main` to GitHub.

The Docker image and Git commit should therefore describe the same tested source tree.

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
- `catalyst`: force Catalyst Embedded Authentication and Catalyst Data Store.

For Catalyst, edit only the `profiles.catalyst` block in `labelkit_config.json`:

- Keep `auth_required` as `true`.
- Keep `auth_mode` as `embedded`.
- Keep `allow_local_json_fallback` as `false`.
- Keep all `*_store` values as `datastore`.
- Keep `role_id_map` aligned to Catalyst Application User role IDs. Current mapping:
  - `27327000000040037` -> `Admin` (`App Administrator`)
  - `27327000000040038` -> `User` (`App User`)
- No separate login URLs are stored in this config. The frontend embeds Catalyst's sign-in iframe directly in the app page with the Catalyst Web SDK.

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
- `B2B Case-Pack Labels`

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
- `GET /api/b2b/label-templates`
- `POST /api/b2b/render` render an editable B2B print run as a print-size PDF
- `POST /api/mpl/orders/lookup` search the connected Zoho Analytics order view and match its SKUs to Product Master
- `GET/POST/DELETE /api/kehe/mpl-drafts`
- `GET /api/kehe/audit-log`

## Michaels Workflow

1. Select `Michaels DTS`.
2. Upload one or more EDI 856 ASN XML files from Infocon.
3. Upload ShipStation shipping-label PDFs.
4. Choose the final PDF order:
   - `Yes — follow uploaded PDF order` keeps every shipping label with its GS1 label and packing list, in the exact sequence of the uploaded ShipStation PDF. This is the default and recommended option.
   - `No — use ASN XML order` keeps the same matched document groups but arranges them in the ASN pack sequence.
5. Click `Generate Labels`.
6. Review the `Matching Report`, including the `Final PDF Order` confirmation.
7. Use `Open Preview` or download the generated PDF.
8. Use `Export for Excel` for the match report CSV.

When more than one ShipStation PDF is uploaded, LabelKit matches every page against the combined XML pack set, preserves each uploaded PDF's boundary, and returns a ZIP containing one generated PDF per uploaded shipping PDF. The in-app preview remains a combined PDF so the full run can still be reviewed in one place.

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
- Table-launched Pack Label and Pallet Label previews are clean single-label previews; generated Pack Label batches still keep selection controls, and generated Pallet Labels still keep pallet remove controls.
- DC Directory read-only view for `Storefront = KeHE` rows.
- GTIN / Packaging Master Table read-only view for `Storefront = KeHE` rows.
- KeHE generation only uses rows marked with `Storefront = KeHE`; missing storefront values default to `KeHE`.
- Product Master and Directory add/edit/delete/import operations are done from `Packing List & Ti-Hi` only.
- Product Master uniqueness is `Storefront + Config ID + Packaging Level` when a Config ID exists; older rows fall back to `Storefront + Packaging Level + SKU`.
- Directory uniqueness is `Storefront + Code`; matching rows merge/update.
- Case rows feed MPL dropdowns and auto palletization automatically.
- Auto Palletize.
- Reverse to XML Palletization.
- Palletization source display: `XML`, `Auto Palletize`, `Manual`, or `MPL`.
- XML files with no explicit item-to-pallet assignment default line items to `Pallet 1` instead of leaving the draft entirely unassigned.
- Unassigned and needs-review rows remain visible when auto palletization cannot safely place all cases.
- Pallet labels render 2 placards per pallet.
- Saved MPL drafts can be reopened and deleted from separate `Open` and `Delete` columns, with timestamp and user columns.
- Change History shows timestamp, user, change type, record, field changed, previous value, and updated value for supported table edits/imports.

## Packing List & Ti-Hi Workflow

`Packing List & Ti-Hi` is a standalone MPL workspace. It reuses the same editor and TI-HI renderer, and its Product Master / Directory tables are the shared source of truth:

- `frankenstein_project/data/mpl_product_master.json`
- `frankenstein_project/data/mpl_directory.json`
- `frankenstein_project/data/kehe_mpl_drafts.json`

The workspace can also create an MPL from Zoho Analytics. Enter a `Sales Order Number` in the Order Data search. The backend reads `Data with Product Details` through the Catalyst Connection `orderdata`. If that number is reused, LabelKit lists the distinct `Ecomdash ID` values with Storefront, Billing Customer Name, and Invoice Date so the user can select the intended order instance; every SKU row sharing that Ecomdash ID is retained. Duplicate `SKUNumber` rows within the selected order are grouped. Analytics `Quantity Ordered` values are eaches; matched KeHE products are converted to cases using the explicit `Eaches / Package` value on the Product Master Case row before palletization (for example, 36 eaches per case). When an Inner Pack row is present, LabelKit also derives the packaging breakdown, such as 6 eaches per inner pack × 6 inner packs per case. It never silently assumes 36: a missing or invalid Case package quantity blocks the conversion with a Product Master correction message. A non-full-case remainder is rounded up and marked for review. A unique enabled Case-level SKU match in Product Master fills description, GTIN, dimensions, storefront, and unit weight, then automatically palletizes and recalculates line, pallet, and total weights. Billing name, phone, street, city, state, ZIP, and country fields populate the MPL `BILL TO` box; the corresponding shipping fields populate `SHIP TO`; and `Order Notes` populate `Shipping Instructions`. Missing or cross-storefront ambiguous SKUs remain editable and receive a condensed review warning. Their order SKU fills `Item Number`, `Product Name` fills Item Description, and any recognized order weight field fills the available line/pallet weight. The unconverted quantity remains labeled `EACHES`; without verified case pack and dimensions the line stays unassigned and is omitted from TI-HI. A line missing only its Each GTIN uses its SKU as Item Number and can still use TI-HI when Case dimensions and weight are available. No TI-HI page is added when the order has no valid TI-HI entries.

For local testing, the `local` LabelKit profile reads the file configured by `analytics_local_file` instead of the Catalyst Connection. It points to the local fixture at `data/KeHE_Michaels_Storefront_Test_Data.csv`. The fixture contains customer contact and address columns and is explicitly excluded from Git. A Docker image built on this workstation still includes the local file unless it is also added to `.dockerignore`. The `catalyst` profile continues to use `orderdata` and does not read the local file.

Required workbook headers: `Sales Order Number`, `SKUNumber`, `Quantity Ordered`, `Billing Customer Name`, `Bill To Phone`, `Billing Street1`, `Billing Street2`, `Billing Street3`, `Billing City`, `Billing State`, `Billing Zip Code`, `Billing Country`, `Ship To Name`, `Ship To Phone`, `Shipping Street1`, `Shipping Street2`, `Shipping Street3`, `Shipping City`, `Shipping State`, `Shipping Zip Code`, `Shipping Country`, and `Order Notes`. `Product Name` is used as the unmatched-SKU description. Optional item identifiers and weight aliases are accepted when present: `Item Number`, `Customer Item Number`, `GTIN`, `UPC`, `Unit Weight Lbs`, `Unit Weight`, `Item Weight Lbs`, `Item Weight`, `Gross Weight Lbs`, `Pallet Weight Lbs`, and `Pallet Weight`.

KeHE reads the same shared tables and filters to rows marked `Storefront = KeHE`. This keeps all storefront data in one place while letting KeHE remain isolated to KeHE rows:

- KeHE Product Master and DC Directory views are read-only.
- Packing List & Ti-Hi table edits can store rows for any storefront, including `KeHE`.
- Rows not marked `Storefront = KeHE` do not appear in the KeHE table views or KeHE generation.
- Mixed storefront SKUs in one standalone MPL are blocked.
- A storefront can be typed freely.

The standalone Product Master groups rows by `Storefront + Config ID` when present, otherwise by the legacy storefront/SKU identity. Each saved row is unique by packaging level, so one configuration can safely contain Each, Inner Pack, Case, Master Case, Pallet, and Shipper Contents rows. Expand a product to edit its labeled identity, template, barcode, dimensions, weights, and pack values; the `Add Level` control appears on that expanded SKU. Dimensions are stored only as separate `Length`, `Width/Breadth`, and `Height` values; gross shipping weight is stored in `Gross Weight`; and generated copy count is stored in `Default Copies`. `Eaches / Package` stores the number of sellable eaches in that packaging level, and the UI derives the readable pack breakdown. Packing-list inclusion is derived from an active Case row instead of a stored flag.

KeHE pack-label eligibility is separate from B2B eligibility. KeHE permits active Case or Inner Pack rows with a GTIN and applies a blank-copy fallback of 2 for Case or 6 for Inner Pack. B2B uses `Available in Label Creator` and `Active` to control general-user availability. `Data Status` is limited to `DRAFT`, `NEEDS_REVIEW`, `VERIFIED`, or `BLOCKED`; it never changes printed label content. `BLOCKED` hides a configuration from general users, while Admin/Editor roles can still inspect, correct, preview, and print it. Missing business values appear as review warnings instead of turning the label creator into a dead end.

The standalone Directory uses searchable customer/destination cards with a persistent editor. The first matching record opens automatically, and selecting `Edit details` moves the full entry form to that record. The responsive two-column editor groups identity, template defaults, receiving details, manufacturer details, addresses, match values, Data Status, and Active state; changes save automatically. `Add Customer / Destination` creates a draft and immediately opens its entry fields. Preview/Label Creator and `Delete record` actions remain visible in the sticky editor header while the fields scroll. Directory rows remain unique by `Storefront + Code`; inactive rows remain visible to administrators for correction work.

Table maintenance tools:

- `Download Product Template` and `Download Directory Template` download import-ready CSV templates.
- `Upload Excel/CSV` opens an import preview with each row selected by default; unchecked rows are skipped.
- `Import Selected Rows` saves only the checked rows and records change history.
- `Export Product CSV` exports the full standalone Product Master table.
- `Export Directory CSV` exports the full standalone Directory table.
- `Change History` opens the audit log for the selected table.
- Dropdowns used for Product Master packaging level, MPL product selection, DC/name, and Ship From/To/Bill To are searchable and keep the dropdown open while filtering.
- Table layouts wrap long GTINs, addresses, emails, audit values, and notes inside their columns.

The standalone table views and major document views are full-screen, route-backed browser views. Opening a table, saved MPL list, import preview, change history, document editor, PDF preview, or TI-HI preview updates the browser hash, for example `#mpl/product-master` or `#kehe/preview`. Use the browser Back button or the left arrow in the window toolbar to return to the previous app view, or use the visible `Close` / `Done` buttons.

## B2B Case-Pack Label Workflow

The B2B page is a working label editor driven by the saved customer/product hierarchy:

1. Select `Customer`, then `Product / Configuration`, then `Packaging Level`. Downstream selectors appear only after the preceding choice. A single matching template resolves automatically; template selection appears only when a choice is genuinely required.
2. Edit the label directly in Section 2. Brown-outlined values are Product Master data and save automatically for authorized users. Green-outlined values are print-run data such as PO, order, invoice, lot, delivery date, project name, allergens, and required statements; these values stay with the current job and are not written to Product Master.
3. Expand `Product & Barcode Settings` when technical setup is needed. It contains description, SKU, customer item, GTIN/UPC, barcode type/level, package quantity, weights, dimensions, verification status, and Label Creator availability. The panel opens automatically when required data or a supported barcode configuration is missing.
4. Section 3 contains only physical-output controls: carton total, start carton, end carton, and copies per carton.
5. Section 4 is the authoritative production-PDF proof. Use `Render Final PDF`, `Open Full Preview`, `Download PDF`, or `Print Labels`.

Loading a Sales Order Number preselects matching customer/product data and populates available print-run fields. If a SKU has no Product Master match, LabelKit creates an editable order-only configuration using the real order customer, SKU, Product Name, item identifier, GTIN, and weight values that are available. It selects the customer template when one can be identified and otherwise uses the Standard Case-Pack template. These fallback values render and print but are not silently saved to Product Master; missing case-pack, barcode, or weight values remain concise review items.

Supported workbook-derived label types:

- Fancy Sprinkles SRD 3x3 and Master-Pack 3x3, two copies per pack.
- DecoPac case 4x6.
- Dutch Bros PFG 3x3 and Dutch Bros Other 3x3.
- Disney case 3x3.
- Standard case-pack 4x6.
- Mixed-case strip 3x1.5.
- Bulk further-processing 4x6.

All nine supported label types have at least one enabled Product Master configuration. The five non-production examples use `SAMPLE-*` configuration/SKU values and `DRAFT` status so they are easy to identify and replace after testing. Fancy SRD, Fancy Master-Pack, Dutch PFG, and Dutch Other share one configurable compact renderer; their titles, copy counts, invoice visibility, and required fields remain template-driven.

Customer-specific fields come from Product Master and Directory. Direct label edits to product text write through to Product Master, while PO/lot/carton/job values remain print-run data. The bundled template registry is `frankenstein_project/data/b2b_label_templates.json`, and the production renderers live under `frankenstein_project/pipelines/b2b_labels/`.

## Master Packing List And TI-HI

The MPL editor supports:

- Add pallet.
- Add line item directly inside a selected pallet.
- Drag line items between pallets.
- Auto palletize.
- Reverse to XML palletization.
- Recalculate weights.
- Name, save, reopen, and delete drafts.
- `Save & Generate PDF`.
- `Generate PDF Only`.
- If XML does not provide pallet assignment, all line items are placed on `Pallet 1` by default so the user always has at least one pallet to review.

Editor, PDF preview, and TI-HI preview are browser-history aware. If a user opens TI-HI from inside the MPL editor, the route changes to a TI-HI route and browser Back returns to the editor instead of losing the draft state.

TI-HI behavior:

- Constraints are pallet-specific.
- Constraints include max length, max width, max height, and max gross weight.
- Case orientation checks both `L x W` and `W x L`.
- Heavier SKUs stay lower; lighter SKUs stack above.
- Layers stay height-compatible.
- Height-zone palletization can fill supported areas at different heights.
- Alternating and mirrored layer patterns reduce repeated weak seams when feasible.
- The TI-HI preview snapshot is used by the generated MPL PDF.

`Save & Generate PDF` saves the MPL draft name and edited values, then generates the PDF. `Generate PDF Only` uses the current editable draft, current reference tables, current pallet assignments, current pallet constraints, and current TI-HI preview state without saving the draft.

## Product Master Schema And B2B Seeds

Current Product Master package fields are:

- `STOREFRONT`, `CONFIG_ID`, `SKU`, `CUSTOMER_ITEM_NUMBER`, `DESCRIPTION`, `PACKAGING_LEVEL`
- `GTIN`, `BARCODE_TYPE`, `BARCODE_LEVEL`, `LABEL_TEMPLATE_ID`
- `LENGTH_IN`, `WIDTH_IN`, `HEIGHT_IN`
- `CASE_QTY`, `EACH_NET_WEIGHT_G`, `PACKAGE_NET_WEIGHT_G`, `GROSS_WEIGHT_LBS`
- `DEFAULT_COPIES`, `PACK_STATEMENT`, `VERIFICATION_STATUS`, `LABEL_ENABLED`, `IS_ACTIVE`, `SOURCE_NOTE`

The former `DIMENSIONS_IN`, `WEIGHT_LBS`, `LABELS_PER_UNIT`, and `LABEL_REQUIRED` columns are obsolete. Legacy headings are accepted for one transition import and converted immediately, but they are never written to JSON or Catalyst and are not included in new templates or exports. TI-HI reads the three numeric dimension fields directly. Product Master writes reconcile rows by key and Catalyst `ROWID`; they do not clear and recreate the table.

Reviewed seed sources are versioned at:

```text
frankenstein_project/data/seeds/b2b_product_master_seed.csv
frankenstein_project/data/seeds/b2b_directory_seed.csv
```

Validate the local migration and seed merge without writing:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit\frankenstein_project"
python scripts\migrate_product_master_and_seed_b2b.py
```

Apply after the dry run reports no conflicts:

```powershell
python scripts\migrate_product_master_and_seed_b2b.py --apply
python scripts\migrate_product_master_and_seed_b2b.py
```

The second command should classify all reviewed seeds as `IDENTICAL`. The reviewed set contains 32 available Product Master configurations and 2 active Directory entries. Five configurations are explicitly marked `SAMPLE-*` / `DRAFT`; source-backed rows remain `NEEDS_REVIEW` where business confirmation is still required. Missing values stay editable and produce print warnings instead of being replaced with guesses.

## Local Run

First-time setup from the repository root:

```powershell
$repo = "C:\Users\JDI Employee\Downloads\merged_labelkit"
Set-Location $repo
py -3.11 -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r ".\frankenstein_project\requirements.txt"
```

Start one local instance:

```powershell
$repo = "C:\Users\JDI Employee\Downloads\merged_labelkit"
Set-Location "$repo\frankenstein_project"
& "$repo\.venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 9000
```

Add `--reload` only while actively developing. The reloader intentionally creates a supervisor and worker process; omit it for single-instance verification. Stop the foreground server with `Ctrl+C`.

Open:

```text
http://127.0.0.1:9000
```

Health check:

```powershell
Invoke-RestMethod "http://127.0.0.1:9000/health"
```

Expected signal:

- `status` is `ok`.
- `frontend_found` is `true`.

### MPL Ti-Hi editing

- `Ti-Hi Settings` is one order-level action in the MPL toolbar beside Add Pallet, Auto Palletize, and Recalculate Weights.
- Settings shows the pallet count and constraint form only. It supports All pallets or one specific pallet and Recalculate re-optimizes the complete order.
- `Edit Ti-Hi` is available from each pallet's live preview. It opens that pallet's preview and constraint editor without Recalculate, so it does not reorganize pallet contents.
- Back and Close from either Ti-Hi view return directly to Review & Edit Master Packing List.

## Docker Run

Build from repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
docker build --pull --build-arg APP_VERSION=2026.08.31-michaels-multipdf -t merged-labelkit:latest .
```

Run locally:

```powershell
docker run --rm -p 9000:9000 --name merged-labelkit-local merged-labelkit:latest
```

Verify container status:

```powershell
docker ps --filter "name=merged-labelkit-local"
Invoke-RestMethod "http://127.0.0.1:9000/health"
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
docker build --pull --build-arg APP_VERSION=2026.08.31-michaels-multipdf -t merged-labelkit:latest .
catalyst deploy appsail --name merged-labelkit --source docker://merged-labelkit:latest --port 9000
```

The Catalyst CLI command deploys to the active project's Development environment. Confirm `.catalystrc` points to project `27327000000040032` and environment `921277719` before deploying.

Verify:

```powershell
Invoke-RestMethod "https://mergedlabelkit.development.catalystappsail.com/health"
```

Expected response includes:

```json
{"status":"ok"}
```

After the health check, sign in through Embedded Authentication and confirm:

- `/api/auth/session` reports the expected user and LabelKit role.
- Product Master and Directory APIs report `source: "datastore"`.
- One sales order can be loaded in Packing List and B2B.
- One representative PDF can be generated from each required workflow.

## Catalyst Cloud Auth And Storage

Current production design:

- Embedded Authentication.
- Invite-only users controlled from Zoho/Catalyst.
- Catalyst roles are mapped into LabelKit roles.
- Current Catalyst role IDs:
  - `27327000000040037` / `App Administrator` -> `Admin`
  - `27327000000040038` / `App User` -> `User`
- Optional future Catalyst roles with `Editor` or `Edit` in the name map to LabelKit `Editor`.
- Catalyst Data Store is the production source of truth.
- Local JSON files are development fallback only.
- Saved MPL records store the editable draft JSON in `kehe_mpl_drafts`; generated PDF previews remain temporary.
- Saved MPL summaries expose timestamp and user. User metadata is stored in the saved draft JSON for compatibility with the existing Catalyst table schema.
- The frontend shows a login gate when `AUTH_REQUIRED=true` and no Catalyst user session is present.
- Backend endpoints enforce permissions; hiding buttons in the browser is not the security boundary.

Cloud source-of-truth rule:

- Deployed Catalyst reads `frankenstein_project/labelkit_config.json`.
- With `active_profile=auto`, AppSail selects the `catalyst` profile automatically.
- The `catalyst` profile must keep:
  - `app_env=production`
  - `auth_required=true`
  - `auth_mode=embedded`
  - `allow_local_json_fallback=false`
  - `allow_browser_local_cache=false`
  - `mpl_product_master_store=datastore`
  - `mpl_directory_store=datastore`
  - `mpl_drafts_store=datastore`
  - `audit_log_store=datastore`
- Embedded Authentication renders inside `#embedded-auth-frame` on the app page using `catalyst.auth.signIn(...)`.
- Sign out uses the Catalyst Web SDK and reloads the app.
- `datastore` mode is strict. If Data Store is unavailable in deployed Catalyst, table reads/writes and saved MPL reads/writes fail with `Cloud data unavailable` instead of falling back to bundled JSON.
- `auto` mode is for local/development only; it can try Data Store first and then fall back to JSON.
- `file` mode is for local JSON-only testing.
- Do not merge browser `localStorage` or local JSON into cloud tables in production.
- In production, master-table browser `localStorage` cache/fallback is disabled.
- Keep `allow_environment_overrides=false` unless you intentionally want AppSail environment variables to override the single config file.

Catalyst tables and role config:

- `mpl_product_master` / table ID `27327000000097737`
- `mpl_directory` / table ID `27327000000099096`
- `kehe_mpl_drafts` / table ID `27327000000099455`
- `kehe_audit_log` / table ID `27327000000099814`
- `role_id_map.27327000000040037=Admin`
- `role_id_map.27327000000040038=User`

Zoho Analytics Order Data config:

- Connection link name: `orderdata`
- Required connection scope: `ZohoAnalytics.data.read`
- Optional auto-discovery scope: `ZohoAnalytics.metadata.read`
- Workspace: `1436788000013504925`
- View: `1436788000014668542` (`Data with Product Details`)
- Lookup columns: `Sales Order Number`, `SKUNumber`, `Quantity Ordered`
- If the connection does not return a `ZANALYTICS-ORGID` header and does not have the metadata-read scope, set `analytics_org_id` in `frankenstein_project/labelkit_config.json`.

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
- `Editor`: product/directory CRUD, create/save MPL, audit view, and all generation workflows. This role is available if a Catalyst role containing `Editor` or `Edit` is added later.
- `User`: preview/generate/open allowed documents only; no product/directory CRUD and no destructive saved MPL actions.

Operational setup checklist:

1. Configure Catalyst Embedded Authentication in the Catalyst console.
2. Keep Public Signup disabled for invite-only access.
3. Use the existing Catalyst roles `App Administrator` and `App User`, or add an optional `App Editor` role if that middle permission tier is needed.
4. Add invited users and assign roles from Catalyst Authentication > User Management.
5. Keep `auth_mode=embedded` in `frankenstein_project/labelkit_config.json`.
6. Confirm the four Data Store tables exist and are seeded.
7. Deploy with `active_profile=auto` or `active_profile=catalyst`; keep the `catalyst` profile on Data Store with local fallback disabled.
8. Verify `/api/auth/session` returns the signed-in user and role.
9. Verify table APIs return `source: "datastore"`.
10. Validate with one `App Administrator` and one `App User` account before deploying broadly. If an editor role is added later, validate that account too.

Cloud edge cases to test:

- Session expires while editing.
- User is disabled or role-changed while the app is open.
- Two users edit the same row.
- Excel/import batch partially fails.
- Storefront is changed from `KeHE` to another storefront and disappears from KeHE views.
- Data Store is unavailable.
- Saved MPL draft exists but its draft JSON is malformed or missing fields.
- Unauthorized direct API calls.

## Validation Commands

Run from repo root:

```powershell
Set-Location "C:\Users\JDI Employee\Downloads\merged_labelkit"
```

Regression suite:

```powershell
Set-Location ".\frankenstein_project"
python -m unittest discover -s tests -v
Set-Location ".."
```

Python compile:

```powershell
& ".\.venv\Scripts\python.exe" -m py_compile ".\frankenstein_project\server.py"
& ".\.venv\Scripts\python.exe" -m py_compile ".\frankenstein_project\pipelines\kehe_pipeline.py"
& ".\.venv\Scripts\python.exe" -m py_compile ".\frankenstein_project\pipelines\michaels_label_pipeline.py"
& ".\.venv\Scripts\python.exe" -m py_compile ".\frankenstein_project\pipelines\kehe\common.py"
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
'@ | & ".\.venv\Scripts\python.exe" -
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
    "POST /api/mpl/orders/lookup",
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
    |   |-- b2b_label_templates.json
    |   |-- kehe_mpl_drafts.json
    |   |-- mpl_directory.json
    |   |-- mpl_product_master.json
    |   `-- seeds
    |       |-- b2b_directory_seed.csv
    |       `-- b2b_product_master_seed.csv
    |-- frontend
    |   `-- dist
    |       |-- index.html
    |       `-- assets
    |           |-- css
    |           |   `-- app.css
    |           `-- js
    |               `-- app.js
    |-- scripts
    |   `-- migrate_product_master_and_seed_b2b.py
    |-- tests
    |   |-- test_b2b_labels.py
    |   |-- test_kehe_gs1_label.py
    |   |-- test_mpl_templates.py
    |   |-- test_order_lookup.py
    |   `-- test_product_master_migration.py
    `-- pipelines
        |-- b2b_labels
        |   |-- __init__.py
        |   `-- renderer.py
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
- In local development, `kehe_mpl_drafts.json` is the saved MPL draft fallback source.
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
- local-only runtime audit files unless intentionally seeding them
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
- [ ] Commit the exact source used for the verified image on `main`.
- [ ] Push `origin main`.
- [ ] Confirm route-backed views open and close with browser Back for table, preview, editor, import, audit, saved MPL, and TI-HI views.
- [ ] Confirm `Export Product CSV` and `Export Directory CSV` download the full standalone tables.
- [ ] Confirm `git status --short` is clean.
