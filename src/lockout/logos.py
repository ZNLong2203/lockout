"""Team logos from Leaguepedia (lol.fandom.com), resolved once and cached as URLs.

We never download or store the images: the cache holds only ``team name -> image URL`` and the browser
loads each logo from Fandom's CDN at runtime (it sends ``Access-Control-Allow-Origin: *``). Logos are the
teams' trademarks; Leaguepedia is credited in the UI footer.

Resolution: GRID team name -> ``TeamRedirects.AllName`` (covers old names and spellings) -> the team's
overview page -> ``"<page>logo square.png"`` (the transparent square crest), falling back to the image
listed on the ``Teams`` row. The anonymous Cargo API is rate limited, so requests are batched and retried.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

API = "https://lol.fandom.com/api.php"
USER_AGENT = "lockout/0.1 (hackathon scouting tool; logo lookup)"
LOGO_FILE = "team_logos.json"
THUMB_WIDTH = 128

log = logging.getLogger(__name__)

Fetch = Callable[[dict[str, str]], dict[str, Any]]


def _http_fetch(params: dict[str, str], retries: int = 5) -> dict[str, Any]:
    body = urllib.parse.urlencode({**params, "format": "json"}).encode()
    delay = 4.0
    for attempt in range(retries):
        req = urllib.request.Request(API, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
        except (urllib.error.URLError, TimeoutError) as exc:
            if attempt == retries - 1:
                raise
            log.info("logo lookup failed (%s), retrying in %.0fs", exc, delay)
        else:
            error = data.get("error", {})
            if error.get("code") != "ratelimited" and "rate limit" not in str(
                error.get("info", "")
            ):
                return data
            log.info("Leaguepedia rate limit, retrying in %.0fs", delay)
        time.sleep(delay)
        delay *= 2
    raise RuntimeError("Leaguepedia kept rate limiting the logo lookup; try again later.")


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _quote(name: str) -> str:
    return '"' + name.replace("\\", "").replace('"', "") + '"'


def overview_pages(names: list[str], fetch: Fetch) -> dict[str, tuple[str, str]]:
    """Map each lower-cased team name to (overview page, listed image) via Leaguepedia's redirects table."""
    found: dict[str, tuple[str, str]] = {}
    for chunk in _chunks(names, 60):
        data = fetch(
            {
                "action": "cargoquery",
                "tables": "TeamRedirects=TR,Teams=T",
                "join_on": "TR._pageName=T.OverviewPage",
                "fields": "TR.AllName=name,T.OverviewPage=page,T.Image=image",
                "where": f"TR.AllName IN ({','.join(_quote(n) for n in chunk)})",
                "limit": "500",
            }
        )
        for row in data.get("cargoquery", []):
            t = row.get("title", {})
            if t.get("name") and t.get("page"):
                found.setdefault(t["name"].lower(), (t["page"], t.get("image") or ""))
        time.sleep(1.0)
    # fallback for names the redirects miss: a team's display name or short code (e.g. "C9")
    rest = [n for n in names if n.lower() not in found]
    for chunk in _chunks(rest, 60):
        listed = ",".join(_quote(n) for n in chunk)
        data = fetch(
            {
                "action": "cargoquery",
                "tables": "Teams=T",
                "fields": "T.Name=name,T.Short=short,T.OverviewPage=page,T.Image=image",
                "where": f"T.Name IN ({listed}) OR T.Short IN ({listed})",
                "limit": "500",
            }
        )
        asked = {n.lower() for n in chunk}
        for row in data.get("cargoquery", []):
            t = row.get("title", {})
            if not t.get("page"):
                continue
            for key in (t.get("name") or "", t.get("short") or ""):
                if key.lower() in asked:
                    found.setdefault(key.lower(), (t["page"], t.get("image") or ""))
        time.sleep(1.0)
    return found


def image_urls(files: list[str], fetch: Fetch) -> dict[str, str]:
    """Thumbnail URL of each existing file (``File:`` titles without the prefix); missing files are left out."""
    urls: dict[str, str] = {}
    for chunk in _chunks(files, 50):
        data = fetch(
            {
                "action": "query",
                "titles": "|".join(f"File:{f}" for f in chunk),
                "prop": "imageinfo",
                "iiprop": "url",
                "iiurlwidth": str(THUMB_WIDTH),
            }
        )
        query = data.get("query", {})
        # MediaWiki normalises titles (underscores, first letter); map them back to what we asked for
        back = {n["to"]: n["from"] for n in query.get("normalized", [])}
        for page in query.get("pages", {}).values():
            info = page.get("imageinfo")
            if "missing" in page or not info:
                continue
            asked = back.get(page["title"], page["title"]).removeprefix("File:")
            urls[asked.replace("_", " ")] = info[0].get("thumburl") or info[0]["url"]
        time.sleep(1.0)
    return urls


def _shorter(name: str) -> str:
    words = name.split()
    return " ".join(words[:-1]) if len(words) > 1 and len(" ".join(words[:-1])) >= 2 else ""


def resolve_logos(names: list[str], fetch: Fetch = _http_fetch) -> dict[str, str]:
    """``{team name: logo URL}`` for every name Leaguepedia knows."""
    pages = overview_pages(sorted(set(names)), fetch)
    # sponsor suffixes ("Cloud9 Kia", "Gen.G Esports"): retry with the last word dropped
    shorter = {n: _shorter(n) for n in names if n.lower() not in pages and _shorter(n)}
    if shorter:
        more = overview_pages(sorted(set(shorter.values())), fetch)
        for name, short in shorter.items():
            if short.lower() in more:
                pages[name.lower()] = more[short.lower()]
    wanted: set[str] = set()
    for page, image in pages.values():
        wanted.add(f"{page}logo square.png")
        if image:
            wanted.add(image)
    urls = image_urls(sorted(wanted), fetch)
    out: dict[str, str] = {}
    for name in names:
        hit = pages.get(name.lower())
        if not hit:
            continue
        page, image = hit
        url = urls.get(f"{page}logo square.png") or urls.get(image.replace("_", " "))
        if url:
            out[name] = url
    return out


def logo_path(cache_dir: Path) -> Path:
    return cache_dir / LOGO_FILE


def load_logos(cache_dir: Path) -> dict[str, str]:
    path = logo_path(cache_dir)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        str(k): str(v) for k, v in data.items() if isinstance(v, str) and v.startswith("https://")
    }


def save_logos(cache_dir: Path, logos: dict[str, str]) -> Path:
    path = logo_path(cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(logos, indent=1, sort_keys=True))
    return path
