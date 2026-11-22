"""Export the public (Leaguepedia) cache as static JSON for the hosted demo (``web/public/data``).

The web app's static mode reads these files instead of calling the API, so the GitHub Pages demo runs the draft
features on real teams and real games without a server. Everything here is derived from Leaguepedia
(CC BY-SA 3.0), never from the licensed GRID data.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from lockout.api.queries import NotFoundError, Repository
from lockout.config import Settings
from lockout.draft import winmodel as wm
from lockout.logos import resolve_logos

MIN_GAMES = 10  # teams with fewer games in the window are left out of the demo
SERIES_DRAFTS = 160  # most recent multi-game series exported for the replay
ATTRIBUTION = "Draft data: Leaguepedia (lol.fandom.com), CC BY-SA 3.0"


def public_settings(root: Path) -> Settings:
    return Settings(data_dir=root / "data", cache_dir=root / "cache")


def slug(value: str) -> str:
    """A short, URL-safe file name for an id with spaces and slashes (Leaguepedia page names)."""
    return hashlib.sha1(value.encode()).hexdigest()[:12]


def clean(name: str) -> str:
    """Leaguepedia disambiguates page names ("LYON (2024 American Team)"); show the team's own name."""
    return re.sub(r" \([^)]*\)$", "", name or "")


def _clean_names(value: Any) -> Any:
    """Apply `clean` to every team-name field of an exported structure."""
    if isinstance(value, dict):
        return {
            k: clean(v) if k in ("name", "opponent") and isinstance(v, str) else _clean_names(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [_clean_names(v) for v in value]
    return value


def _dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean_names(value), separators=(",", ":"), default=str))


def _model(m: Any) -> Any:
    return m.model_dump(mode="json") if hasattr(m, "model_dump") else m


def export(root: Path, out: Path, logos: bool = True) -> dict[str, int]:
    repo = Repository(public_settings(root))
    teams = [t for t in repo.teams() if t.games >= MIN_GAMES]
    ids = {t.team_id for t in teams}
    # ids become file-safe; the original name stays as the display name
    _dump(out / "teams.json", [{**_model(t), "team_id": slug(t.team_id)} for t in teams])
    if logos:
        _dump(
            out / "logos.json",
            {"logos": resolve_logos([t.name for t in teams]), "source": "Leaguepedia"},
        )
    _dump(out / "champions.json", [_model(c) for c in repo.champions()])
    rows, elo_hist = repo._win_rows()
    try:
        league_top3 = [d.share_top3 for d in repo.backtest().pick_depth]
        _dump(out / "backtest.json", _model(repo.backtest()))
    except NotFoundError:
        league_top3 = []
    _dump(
        out / "league.json",
        {
            "role_by_pick": repo._role_by_pick(repo._as_of()),
            "league_top3_share_by_game": league_top3,
            "attribution": ATTRIBUTION,
        },
    )
    for t in teams:
        try:
            ctx = repo._context_team(t.team_id)
        except NotFoundError:
            continue
        tendencies = {}
        for scope in ("all", "g1", "later"):
            with contextlib.suppress(NotFoundError):
                report = repo.draft_tendencies(t.team_id, scope)  # type: ignore[arg-type]
                tendencies[scope] = {**_model(report), "team_id": slug(t.team_id)}
        _dump(
            out / "teams" / f"{slug(t.team_id)}.json",
            {
                "context": {**_model(ctx), "team_id": slug(t.team_id)},
                "recent": [_model(g) for g in repo._recent_games(t.team_id)],
                "elo": [[when.isoformat(), round(v, 2)] for when, v in elo_hist.get(t.team_id, [])],
                "tendencies": tendencies,
            },
        )
    # the win model, fitted on every public game, with its time-split evaluation
    fitted = wm.fit(rows)
    ev = wm.evaluate(rows)
    _dump(
        out / "win-model.json",
        {
            "features": list(wm.FEATURES),
            "mean": fitted.mean,
            "scale": fitted.scale,
            "coef": fitted.coef,
            "intercept": fitted.intercept,
            "n_train": fitted.n_train,
            "meta_days": wm.META_DAYS,
            "prior": wm.PRIOR,
            "pool_top": wm.POOL_TOP,
            "evaluation": {k: v for k, v in asdict(ev).items() if k != "notes"},
            "season_gap_days": wm.SEASON_GAP_DAYS,
            "season_reset": wm.SEASON_RESET,
        },
    )
    # real series for the replay: the most recent multi-game ones between demo teams
    summaries = [s for s in repo.series_list(limit=1000) if {x.team_id for x in s.teams} <= ids]

    def flip(summary: Any) -> dict[str, Any]:
        return {
            **_model(summary),
            "series_id": slug(summary.series_id),
            "teams": [{**_model(x), "team_id": slug(x.team_id)} for x in summary.teams],
        }

    exported = 0
    listed = []
    for s in summaries:
        if s.games < 2 or exported >= SERIES_DRAFTS:
            continue
        d = repo.series_draft(s.series_id)
        body = _model(d)
        body["series"] = flip(d.series)
        for side in ("ours", "opponent"):
            body["context"][side]["team_id"] = slug(body["context"][side]["team_id"])
        for g in body["games"]:
            g["blue_team_id"], g["red_team_id"] = slug(g["blue_team_id"]), slug(g["red_team_id"])
            g["winner_team_id"] = slug(g["winner_team_id"]) if g["winner_team_id"] else None
        body["notes"] = [*d.notes[:1], ATTRIBUTION]
        _dump(out / "series" / f"{slug(s.series_id)}.json", body)
        listed.append(flip(s))
        exported += 1
    _dump(out / "series.json", listed)
    _dump(out / "games.json", _game_index(repo, out))
    return {"teams": len(teams), "series": exported, "games": len(rows)}


def _game_index(repo: Repository, out: Path) -> dict[str, Any]:
    """Teams, players and champions of every game the demo links to, so its simulated replay can carry them."""
    wanted: set[str] = set()
    for f in (out / "teams").glob("*.json"):
        wanted |= {g["game_id"] for g in json.loads(f.read_text())["recent"]}
    for f in (out / "series").glob("*.json"):
        wanted |= {g["game_id"] for g in json.loads(f.read_text())["games"]}
    if not wanted:
        return {}
    marks = ",".join("?" * len(wanted))
    games = repo._rows(
        f"""select g.game_id, g.blue_team_id, g.red_team_id, g.winner_team_id, g.duration_s, g.game_number,
                   any_value(d.event), min(d.started_at)
            from {repo._table("games")} g join {repo._table("draft_enriched")} d using (game_id)
            where g.game_id in ({marks}) group by 1, 2, 3, 4, 5, 6""",
        list(wanted),
    )
    players = repo._rows(
        f"""select game_id, slot, player_id, name, side, role, champion from {repo._table("players")}
            where game_id in ({marks}) order by game_id, slot""",
        list(wanted),
    )
    by_game: dict[str, list[dict[str, Any]]] = {}
    for gid, slot, pid, name, side, role, champ in players:
        by_game.setdefault(gid, []).append(
            {
                "slot": slot,
                "player_id": pid or f"{gid}-{slot}",
                "name": name,
                "side": side,
                "role": role,
                "champion": champ,
            }
        )
    return {
        gid: {
            "blue_team": blue,
            "red_team": red,
            "winner_side": "blue" if winner == blue else "red",
            "duration_s": duration,
            "game_number": number,
            "event": event,
            "started_at": started,
            "players": by_game.get(gid, []),
        }
        for gid, blue, red, winner, duration, number, event, started in games
    }


def elo_before(history: list[list[Any]], t: datetime) -> float:
    """Mirror of winmodel.rating_before for the exported history (used in tests)."""
    rating, last = wm.ELO_START, None
    for when, value in history:
        w = datetime.fromisoformat(when)
        if w >= t:
            break
        rating, last = float(value), w
    if last is not None and t - last > timedelta(days=wm.SEASON_GAP_DAYS):
        rating = wm.ELO_START + (rating - wm.ELO_START) * wm.SEASON_RESET
    return rating
