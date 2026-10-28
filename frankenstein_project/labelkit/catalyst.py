"""Shared Catalyst Data Store access with explicit fallback semantics."""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import HTTPException, Request


class DatastoreRecoveryError(RuntimeError):
    pass


def store_requires_datastore(store_mode: str) -> bool:
    return str(store_mode or "").strip().lower() == "datastore"


def datastore_unavailable(table_name: str, action: str, exc: Optional[Exception] = None, *, app_env: str = "production", logger: Any = None) -> None:
    detail = (
        f"Cloud data unavailable for Catalyst Data Store table '{table_name}' while trying to {action}. "
        "Store mode is 'datastore', so local JSON fallback is disabled."
    )
    if exc is not None and logger is not None:
        logger.exception("Catalyst Data Store failure table=%s action=%s", table_name, action, exc_info=exc)
    if exc is not None and app_env != "production":
        detail += f" {exc.__class__.__name__}: {exc}"
    elif isinstance(exc, DatastoreRecoveryError):
        detail += " Save recovery also failed. Check the table before retrying."
    raise HTTPException(status_code=503, detail=detail)


def table_named(request: Request, table_name: str, store_mode: str, catalyst_factory: Callable[[Request], Any], *, app_env: str = "production", logger: Any = None) -> Any:
    mode = str(store_mode or "auto").strip().lower()
    if mode == "file":
        return None
    app = catalyst_factory(request)
    if app is None:
        if store_requires_datastore(mode):
            datastore_unavailable(table_name, "connect to it", app_env=app_env, logger=logger)
        return None
    try:
        return app.datastore().table(table_name)
    except Exception as exc:
        if store_requires_datastore(mode):
            datastore_unavailable(table_name, "open it", exc, app_env=app_env, logger=logger)
        return None


def get_raw_rows(table_service: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    next_token: Optional[str] = None
    more_records = True
    while more_records:
        try:
            page = table_service.get_paged_rows(next_token, max_rows=100) if next_token else table_service.get_paged_rows(max_rows=100)
        except TypeError:
            page = table_service.get_paged_rows(next_token, 100)
        content: list[Any] = []
        if isinstance(page, dict):
            if isinstance(page.get("content"), list):
                content = page["content"]
            elif isinstance(page.get("data"), list):
                content = page["data"]
        elif isinstance(page, list):
            content = page
        rows.extend(row for row in content if isinstance(row, dict))
        more_records = bool(page.get("more_records")) if isinstance(page, dict) else False
        next_token = page.get("next_token") if isinstance(page, dict) else None
        if not next_token:
            more_records = False
    return rows


def replace_rows(table, rows, *, key, decode, encode, select=lambda row: True):
    """Apply a reviewed snapshot; compensate a failed batch from the prior data."""
    def read():
        return [row for row in get_raw_rows(table) if select(row)]

    def apply(wanted, existing):
        current = {key(decode(row)): row for row in existing if row.get("ROWID")}
        desired = {key(row): row for row in wanted}
        updates, inserts = [], []
        for identity, row in desired.items():
            encoded = encode(row)
            if identity in current:
                encoded["ROWID"] = current[identity]["ROWID"]
                updates.append(encoded)
            else:
                inserts.append(encoded)
        deletes = [row["ROWID"] for identity, row in current.items() if identity not in desired]
        for operation, values, size in ((table.update_rows, updates, 100), (table.insert_rows, inserts, 100), (table.delete_rows, deletes, 200)):
            for offset in range(0, len(values), size):
                operation(values[offset:offset + size])

    before = read()
    try:
        apply(rows, before)
    except Exception:
        try:
            apply([decode(row) for row in before], read())
        except Exception as rollback_error:
            raise DatastoreRecoveryError("Data Store save and recovery both failed. Check the table before retrying.") from rollback_error
        raise
