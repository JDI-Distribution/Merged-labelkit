"""Zoho Analytics order lookup (Catalyst Connection or local spreadsheet)."""

from __future__ import annotations

import csv
import io
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from fastapi import HTTPException, Request

from labelkit.app_config import ConfigResolver
from labelkit.order_intake import _analytics_row_value, _canonical_order_number

LOCAL_SOURCE_VALUES = {"file", "csv", "excel"}
HTTP_TIMEOUT_SECONDS = 30


def _text(value: Any, default: str) -> str:
    return str(value or default).strip()


@dataclass(frozen=True)
class AnalyticsSettings:
    order_source: str
    local_file: Optional[Path]
    connection_link_name: str
    api_base: str
    org_id: str
    workspace_id: str
    view_id: str
    view_name: str
    order_column: str
    sku_column: str
    quantity_column: str
    customer_email_column: str
    item_description_columns: tuple = ("Product Name", "Item Description", "Description")
    item_number_columns: tuple = ("Item Number", "Customer Item Number")
    item_gtin_columns: tuple = ("GTIN", "UPC", "UPC Code", "Barcode")
    item_unit_weight_columns: tuple = (
        "Unit Weight Lbs",
        "Unit Weight",
        "Item Weight Lbs",
        "Item Weight",
        "Gross Weight Lbs",
    )
    item_pallet_weight_columns: tuple = ("Pallet Weight Lbs", "Pallet Weight")
    order_instance_id_column: str = "Ecomdash ID"
    order_instance_date_column: str = "Invoice Date"
    order_instance_storefront_column: str = "Storefront"
    order_detail_columns: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def from_config(cls, config: ConfigResolver, base_dir: Path) -> "AnalyticsSettings":
        def value(env_name: str, key: str, default: str) -> str:
            return _text(config.value(env_name, key, default), default)

        local_file_value = _text(config.value("ANALYTICS_LOCAL_FILE", "analytics_local_file", ""), "")
        local_file: Optional[Path] = None
        if local_file_value:
            candidate = Path(local_file_value)
            local_file = candidate if candidate.is_absolute() else base_dir / candidate

        email_column = value("ANALYTICS_CUSTOMER_EMAIL_COLUMN", "analytics_customer_email_column", "Email")
        return cls(
            order_source=value("ANALYTICS_ORDER_SOURCE", "analytics_order_source", "zoho_analytics").lower(),
            local_file=local_file,
            connection_link_name=value("ANALYTICS_CONNECTION_LINK_NAME", "analytics_connection_link_name", "orderdata"),
            api_base=value("ANALYTICS_API_BASE", "analytics_api_base", "https://analyticsapi.zoho.com").rstrip("/"),
            org_id=_text(config.value("ANALYTICS_ORG_ID", "analytics_org_id", ""), ""),
            workspace_id=value("ANALYTICS_WORKSPACE_ID", "analytics_workspace_id", "1436788000013504925"),
            view_id=value("ANALYTICS_VIEW_ID", "analytics_view_id", "1436788000014668542"),
            view_name=value("ANALYTICS_VIEW_NAME", "analytics_view_name", "Data with Product Details"),
            order_column=value("ANALYTICS_ORDER_COLUMN", "analytics_order_column", "Sales Order Number"),
            sku_column=value("ANALYTICS_SKU_COLUMN", "analytics_sku_column", "SKUNumber"),
            quantity_column=value("ANALYTICS_QUANTITY_COLUMN", "analytics_quantity_column", "Quantity Ordered"),
            customer_email_column=email_column,
            order_detail_columns={
                "storefront": "Storefront",
                "email_id": email_column,
                "billing_customer_name": "Billing Customer Name",
                "bill_to_phone": "Bill To Phone",
                "billing_street1": "Billing Street1",
                "billing_street2": "Billing Street2",
                "billing_street3": "Billing Street3",
                "billing_city": "Billing City",
                "billing_state": "Billing State",
                "billing_zip_code": "Billing Zip Code",
                "billing_country": "Billing Country",
                "ship_to_name": "Ship To Name",
                "ship_to_phone": "Ship To Phone",
                "shipping_street1": "Shipping Street1",
                "shipping_street2": "Shipping Street2",
                "shipping_street3": "Shipping Street3",
                "shipping_city": "Shipping City",
                "shipping_state": "Shipping State",
                "shipping_zip_code": "Shipping Zip Code",
                "shipping_country": "Shipping Country",
                "order_notes": "Order Notes",
            },
        )


class ZohoAnalyticsRequestError(Exception):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _header_value(headers: Dict[str, str], name: str) -> str:
    wanted = name.strip().lower()
    for key, value in headers.items():
        if str(key).strip().lower() == wanted:
            return str(value or "").strip()
    return ""


def _error_detail(raw_body: bytes, fallback: str) -> str:
    body = raw_body.decode("utf-8", errors="replace").strip()
    if body:
        try:
            payload = json.loads(body)
            data = payload.get("data") if isinstance(payload, dict) else {}
            if isinstance(data, dict):
                message = data.get("errorMessage") or data.get("message")
                if message:
                    return str(message)[:600]
            if isinstance(payload, dict) and (payload.get("summary") or payload.get("message")):
                return str(payload.get("summary") or payload.get("message"))[:600]
        except Exception:
            pass
        return body[:600]
    return fallback


def _http_get(url: str, headers: Dict[str, str]) -> bytes:
    request_headers = {"Accept": "application/json, text/csv;q=0.9", **headers}
    api_request = urllib.request.Request(url, headers=request_headers, method="GET")
    try:
        with urllib.request.urlopen(api_request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            return response.read()
    except urllib.error.HTTPError as exc:
        raw_body = exc.read() if exc.fp is not None else b""
        raise ZohoAnalyticsRequestError(
            int(exc.code or 502),
            _error_detail(raw_body, str(exc.reason or "Zoho Analytics request failed.")),
        ) from exc
    except urllib.error.URLError as exc:
        raise ZohoAnalyticsRequestError(502, f"Zoho Analytics is unavailable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise ZohoAnalyticsRequestError(504, "Zoho Analytics did not respond before the request timed out.") from exc


class AnalyticsClient:
    def __init__(
        self,
        settings: AnalyticsSettings,
        init_catalyst_app: Callable[[Request], Any],
        read_spreadsheet_bytes: Callable[[str, bytes], List[Dict[str, Any]]],
    ):
        self.settings = settings
        self._init_catalyst_app = init_catalyst_app
        self._read_spreadsheet_bytes = read_spreadsheet_bytes
        self.discovered_org_id = ""

    def _url(self, path: str, parameters: Optional[Dict[str, str]] = None) -> str:
        url = f"{self.settings.api_base}/{str(path or '').lstrip('/')}"
        if parameters:
            url += "?" + urllib.parse.urlencode(parameters)
        return url

    def _connection_details(self, request: Request) -> tuple[Dict[str, str], Dict[str, str]]:
        link_name = self.settings.connection_link_name
        catalyst_app = self._init_catalyst_app(request)
        if catalyst_app is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Zoho Analytics order lookup is available from the deployed Catalyst AppSail app. "
                    "The Catalyst SDK or runtime connection is unavailable here."
                ),
            )

        connections_factory = getattr(catalyst_app, "connections", None)
        if not callable(connections_factory):
            raise HTTPException(
                status_code=503,
                detail="The installed Catalyst SDK does not support Connections. Install zcatalyst-sdk 1.1 or newer.",
            )

        try:
            response = connections_factory().get_connection_credentials(link_name)
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Catalyst Connection '{link_name}' could not provide Zoho Analytics credentials. "
                    "Confirm that the connection is active, shared with this environment, and has ZohoAnalytics.data.read. "
                    f"{exc.__class__.__name__}: {exc}"
                ),
            ) from exc

        payload = response if isinstance(response, dict) else {}
        details = payload.get("connections") if isinstance(payload.get("connections"), dict) else payload
        raw_headers = details.get("headers") if isinstance(details, dict) else {}
        raw_parameters = details.get("parameters") if isinstance(details, dict) else {}
        headers = {
            str(key): str(value)
            for key, value in (raw_headers.items() if isinstance(raw_headers, dict) else [])
            if str(key).strip() and value is not None
        }
        parameters = {
            str(key): str(value)
            for key, value in (raw_parameters.items() if isinstance(raw_parameters, dict) else [])
            if str(key).strip() and value is not None
        }
        if not headers and not parameters:
            raise HTTPException(
                status_code=503,
                detail=f"Catalyst Connection '{link_name}' returned no authentication details.",
            )
        return headers, parameters

    def _discover_org_ids(self, headers: Dict[str, str], parameters: Dict[str, str]) -> List[str]:
        try:
            raw = _http_get(self._url("/restapi/v2/orgs", parameters), headers)
            payload = json.loads(raw.decode("utf-8-sig", errors="replace"))
            data = payload.get("data") if isinstance(payload, dict) else {}
            orgs = data.get("orgs") if isinstance(data, dict) else []
            if not isinstance(orgs, list):
                return []
            default_ids = [
                str(org.get("orgId") or "").strip()
                for org in orgs
                if isinstance(org, dict) and org.get("isDefault") and str(org.get("orgId") or "").strip()
            ]
            other_ids = [
                str(org.get("orgId") or "").strip()
                for org in orgs
                if isinstance(org, dict) and not org.get("isDefault") and str(org.get("orgId") or "").strip()
            ]
            return default_ids + other_ids
        except ZohoAnalyticsRequestError as exc:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The Zoho Analytics organization ID is not configured and could not be discovered. "
                    "Set analytics_org_id in labelkit_config.json, or add ZohoAnalytics.metadata.read to the "
                    f"'{self.settings.connection_link_name}' connection. {exc.message}"
                ),
            ) from exc
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=502,
                detail="Zoho Analytics returned an invalid organization response.",
            ) from exc

    def _local_rows(self, sales_order_number: str) -> List[Dict[str, str]]:
        local_file = self.settings.local_file
        if local_file is None:
            raise HTTPException(
                status_code=503,
                detail="Local Analytics testing requires 'analytics_local_file' in the local LabelKit profile.",
            )
        if not local_file.is_file():
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Local order workbook was not found at '{local_file}'. "
                    "Add the configured .csv or .xlsx file before searching for an order."
                ),
            )
        try:
            local_rows = self._read_spreadsheet_bytes(local_file.name, local_file.read_bytes())
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Local order workbook could not be read: {exc}",
            ) from exc
        wanted_order = _canonical_order_number(sales_order_number)
        return [
            {str(key): value for key, value in row.items()}
            for row in local_rows
            if _canonical_order_number(_analytics_row_value(row, self.settings.order_column)) == wanted_order
        ]

    def export_order_rows(self, request: Request, sales_order_number: str) -> List[Dict[str, str]]:
        settings = self.settings
        if settings.order_source in LOCAL_SOURCE_VALUES:
            return self._local_rows(sales_order_number)

        headers, connection_parameters = self._connection_details(request)
        header_org_id = _header_value(headers, "ZANALYTICS-ORGID")
        configured_org_id = settings.org_id or header_org_id or self.discovered_org_id
        org_ids = [configured_org_id] if configured_org_id else self._discover_org_ids(headers, connection_parameters)
        org_ids = list(dict.fromkeys(org_id for org_id in org_ids if org_id))
        if not org_ids:
            raise HTTPException(
                status_code=503,
                detail="No accessible Zoho Analytics organization was found for the 'orderdata' connection.",
            )

        safe_order = sales_order_number.replace("'", "''")
        safe_order_column = settings.order_column.replace('"', '""')
        export_config = {
            "responseFormat": "csv",
            "criteria": f'"{safe_order_column}"=\'{safe_order}\'',
            "selectedColumns": list(dict.fromkeys([
                settings.order_column,
                settings.sku_column,
                settings.quantity_column,
                settings.order_instance_id_column,
                settings.order_instance_date_column,
                settings.order_instance_storefront_column,
                *settings.order_detail_columns.values(),
            ])),
            "includeHeader": True,
        }
        parameters = dict(connection_parameters)
        parameters["CONFIG"] = json.dumps(export_config, separators=(",", ":"))
        path = f"/restapi/v2/workspaces/{settings.workspace_id}/views/{settings.view_id}/data"
        last_error: Optional[ZohoAnalyticsRequestError] = None

        for org_id in org_ids:
            request_headers = {
                key: value
                for key, value in headers.items()
                if str(key).strip().lower() != "zanalytics-orgid"
            }
            request_headers["ZANALYTICS-ORGID"] = org_id
            try:
                raw = _http_get(self._url(path, parameters), request_headers)
                self.discovered_org_id = org_id
                text = raw.decode("utf-8-sig", errors="replace")
                wanted_order = _canonical_order_number(sales_order_number)
                return [
                    dict(row)
                    for row in csv.DictReader(io.StringIO(text))
                    if _canonical_order_number(_analytics_row_value(row, settings.order_column)) == wanted_order
                ]
            except ZohoAnalyticsRequestError as exc:
                last_error = exc

        error_detail = last_error.message if last_error else "The Analytics view could not be read."
        raise HTTPException(
            status_code=502,
            detail=(
                f"Zoho Analytics could not read '{settings.view_name}' with connection "
                f"'{settings.connection_link_name}'. {error_detail}"
            ),
        )
