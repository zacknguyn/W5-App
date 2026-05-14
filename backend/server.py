from __future__ import annotations

import json
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .handlers import (
    get_alerts,
    get_assets,
    get_meta,
    get_settings,
    mark_alert_read,
    options,
    save_settings,
    update_asset_watch,
)


def make_event(
    handler: BaseHTTPRequestHandler,
    body: str,
    path_parameters: dict[str, str] | None = None,
) -> dict[str, Any]:
    parsed = urlparse(handler.path)

    return {
        "httpMethod": handler.command,
        "path": parsed.path,
        "queryStringParameters": {
            key: values[-1] if values else ""
            for key, values in parse_qs(parsed.query).items()
        },
        "headers": dict(handler.headers.items()),
        "pathParameters": path_parameters or {},
        "body": body,
    }


class ApiHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_lambda_response(options())

    def do_GET(self) -> None:
        self.route()

    def do_PUT(self) -> None:
        self.route()

    def route(self) -> None:
        parsed = urlparse(self.path)
        body = self.read_body()

        if self.command == "GET" and parsed.path == "/api/assets":
            result = get_assets(make_event(self, body))
        elif self.command == "GET" and parsed.path == "/api/meta":
            result = get_meta(make_event(self, body))
        elif self.command == "GET" and parsed.path == "/api/alerts":
            result = get_alerts(make_event(self, body))
        elif self.command == "GET" and parsed.path == "/api/settings":
            result = get_settings(make_event(self, body))
        elif self.command == "PUT" and parsed.path == "/api/settings":
            result = save_settings(make_event(self, body))
        elif self.command == "PUT" and (
            match := re.fullmatch(r"/api/assets/([^/]+)/watch", parsed.path)
        ):
            result = update_asset_watch(
                make_event(self, body, {"ticker": unquote(match.group(1))})
            )
        elif self.command == "PUT" and (
            match := re.fullmatch(r"/api/alerts/([^/]+)/read", parsed.path)
        ):
            result = mark_alert_read(
                make_event(self, body, {"id": unquote(match.group(1))})
            )
        else:
            result = {
                "statusCode": 404,
                "headers": {"content-type": "application/json; charset=utf-8"},
                "body": json.dumps({"message": "Not found"}),
            }

        self.send_lambda_response(result)

    def read_body(self) -> str:
        content_length = int(self.headers.get("content-length", "0"))
        if content_length == 0:
            return ""
        return self.rfile.read(content_length).decode("utf-8")

    def send_lambda_response(self, result: dict[str, Any]) -> None:
        self.send_response(result["statusCode"])
        for header, value in result.get("headers", {}).items():
            self.send_header(header, value)
        self.end_headers()
        self.wfile.write(result.get("body", "").encode("utf-8"))

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    port = int(os.environ.get("PORT", "8787"))
    server = ThreadingHTTPServer(("localhost", port), ApiHandler)
    print(f"Backend API listening on http://localhost:{port}/api")
    server.serve_forever()


if __name__ == "__main__":
    main()
