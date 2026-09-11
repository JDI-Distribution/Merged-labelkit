"""Post-deploy LabelKit smoke checks with no write operations."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def fetch(base_url: str, path: str) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(base_url.rstrip("/") + path, headers={"User-Agent": "labelkit-deploy-validator/1"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers.items()), exc.read()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("base_url", nargs="?", default="http://127.0.0.1:9000")
    parser.add_argument("--production", action="store_true")
    args = parser.parse_args()
    failures: list[str] = []

    status, headers, body = fetch(args.base_url, "/health")
    try:
        health = json.loads(body)
    except Exception:
        health = {}
    if status != 200 or health.get("status") != "ok" or not health.get("frontend_found"):
        failures.append("health endpoint is not ready")
    normalized_headers = {name.lower(): value for name, value in headers.items()}
    for required in ("X-Content-Type-Options", "X-Request-ID", "Referrer-Policy"):
        if required.lower() not in normalized_headers:
            failures.append(f"missing security header: {required}")

    home_status, _, home = fetch(args.base_url, "/")
    if home_status != 200 or b"LabelKit" not in home:
        failures.append("frontend entry point is unavailable")

    api_status, _, _ = fetch(args.base_url, "/api/mpl/product-master")
    if args.production and api_status not in {401, 403}:
        failures.append(f"unauthenticated Product Master returned {api_status}, expected 401/403")
    if not args.production and api_status != 200:
        failures.append(f"local Product Master returned {api_status}")

    if failures:
        print(json.dumps({"ok": False, "base_url": args.base_url, "failures": failures}, indent=2))
        return 1
    print(json.dumps({"ok": True, "base_url": args.base_url, "checks": 3}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
