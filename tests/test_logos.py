"""Logo lookup against a fake Leaguepedia (no network)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

import lockout.logos as logos
from asgi_client import AsgiClient
from lockout.api.app import create_app
from lockout.config import Settings
from synthetic_cache import build_synthetic_cache

CDN = "https://static.wikia.nocookie.net/x/"


def fake_fetch(params: dict[str, str]) -> dict[str, Any]:
    if params["action"] == "cargoquery":
        rows = [
            {"name": "Cloud9", "page": "Cloud9", "image": "Cloud9logo profile.png"},
            {"name": "C9", "page": "Cloud9", "image": "Cloud9logo profile.png"},
            {"name": "Old Team", "page": "Old Team", "image": "Old Teamlogo profile.png"},
        ]
        if params["tables"] == "Teams=T":  # fallback by display name / short code
            rows = [
                {"name": "Team Liquid", "short": "TL", "page": "Team Liquid", "image": "TL.png"}
            ]
            return {
                "cargoquery": [{"title": r} for r in rows if f'"{r["short"]}"' in params["where"]]
            }
        return {"cargoquery": [{"title": r} for r in rows if f'"{r["name"]}"' in params["where"]]}
    titles = params["titles"].split("|")
    pages: dict[str, Any] = {}
    for i, title in enumerate(titles):
        norm = title.replace("_", " ")
        if (
            norm == "File:Old Teamlogo square.png"
        ):  # no square crest: falls back to the listed image
            pages[str(-i - 1)] = {"title": norm, "missing": ""}
        else:
            pages[str(i)] = {
                "title": norm,
                "imageinfo": [{"url": CDN + norm, "thumburl": CDN + "t/" + norm}],
            }
    return {"query": {"pages": pages}}


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(logos.time, "sleep", lambda _s: None)


def test_prefers_the_square_crest_and_falls_back_to_the_listed_image() -> None:
    found = logos.resolve_logos(["Cloud9", "C9", "Old Team", "TL", "Unknown"], fake_fetch)
    assert found["TL"].endswith("Team Liquidlogo square.png")
    assert logos.resolve_logos(["Cloud9 Kia"], fake_fetch)["Cloud9 Kia"] == found["Cloud9"]
    assert found["Cloud9"] == CDN + "t/File:Cloud9logo square.png"
    assert found["C9"] == found["Cloud9"]
    assert found["Old Team"].endswith("Old Teamlogo profile.png")
    assert "Unknown" not in found


def test_cache_round_trip_ignores_non_https(tmp_path: Path) -> None:
    logos.save_logos(tmp_path, {"A": "https://cdn/a.png", "B": "javascript:alert(1)"})
    assert logos.load_logos(tmp_path) == {"A": "https://cdn/a.png"}
    assert logos.load_logos(tmp_path / "missing") == {}


def test_api_serves_the_cached_logos(tmp_path: Path) -> None:
    settings: Settings = build_synthetic_cache(tmp_path)
    client = AsgiClient(create_app(settings))
    assert client.get("/api/logos").json() == {"logos": {}, "source": "Leaguepedia"}
    logos.save_logos(settings.cache_dir, {"Alpha": "https://cdn/alpha.png"})
    assert client.get("/api/logos").json()["logos"] == {"Alpha": "https://cdn/alpha.png"}
