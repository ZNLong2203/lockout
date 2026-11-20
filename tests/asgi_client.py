"""A minimal in-process client for the ASGI app, so the API tests need no HTTP-client dependency.

Starlette's ``TestClient`` needs ``httpx2`` (Starlette 1.10) and the project keeps its dependency list short.
``AsgiClient`` offers the one thing the tests use: ``get(url, params=...)`` returning a response with
``status_code``, ``text`` and ``json()``. It is a drop-in for ``TestClient`` if that is ever installed.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode


@dataclass(frozen=True)
class Response:
    status_code: int
    content: bytes

    @property
    def text(self) -> str:
        return self.content.decode("utf-8")

    def json(self) -> Any:
        return json.loads(self.content)


class AsgiClient:
    def __init__(self, app: Any) -> None:
        self.app = app

    def get(self, url: str, params: Mapping[str, str] | None = None) -> Response:
        return asyncio.run(self._call(url, params or {}))

    async def _call(self, path: str, params: Mapping[str, str]) -> Response:
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "root_path": "",
            "query_string": urlencode(params).encode(),
            "headers": [(b"host", b"testserver")],
            "server": ("testserver", 80),
            "client": ("testclient", 50000),
        }
        sent = False

        async def receive() -> dict[str, Any]:
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": b"", "more_body": False}

        status = 500
        body = b""

        async def send(message: dict[str, Any]) -> None:
            nonlocal status, body
            if message["type"] == "http.response.start":
                status = message["status"]
            elif message["type"] == "http.response.body":
                body += message.get("body", b"")

        await self.app(scope, receive, send)
        return Response(status, body)
