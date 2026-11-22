"""Build a Lockout cache from Leaguepedia's public draft data, for the hosted demo.

Leaguepedia (lol.fandom.com) publishes every professional game's draft (``PicksAndBansS7``: the 20 steps in
order, with the role of each pick) and its scoreboard (``ScoreboardGames``: teams, winner, date, patch, players and
champions in role order). Its content is licensed CC BY-SA 3.0, so a demo built from it can be public, with
attribution. It has no player positions: the draft features run on it, the macro scouting does not.

The output mirrors the GRID cache (``draft_enriched``, ``games``, ``players`` and empty position tables), so the
API, the models and the training scripts run on it unchanged.
"""

from __future__ import annotations

import csv
import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from lockout.logos import _http_fetch

SINCE = "2025-01-01"
LEAGUES = (
    'SG.OverviewPage LIKE "LCK/%"',
    'SG.OverviewPage LIKE "LEC/%"',
    'SG.OverviewPage LIKE "LTA%"',
    'SG.OverviewPage LIKE "LCS/%"',
    'SG.OverviewPage LIKE "First Stand%"',
    'SG.OverviewPage LIKE "%Mid-Season Invitational%"',
    'SG.OverviewPage LIKE "%Season World Championship%"',
)
ROLES = ("top", "jungle", "mid", "adc", "support")
ROLE_NAMES = {"top": "top", "jungle": "jungle", "mid": "mid", "bot": "adc", "support": "support"}
# tournament draft order as (side, action, n-th of that side and action); mirrors web/src/lib/draft.ts ORDER
ORDER = (
    [("blue", "ban", 1), ("red", "ban", 1), ("blue", "ban", 2), ("red", "ban", 2), ("blue", "ban", 3), ("red", "ban", 3)]
    + [("blue", "pick", 1), ("red", "pick", 1), ("red", "pick", 2), ("blue", "pick", 2), ("blue", "pick", 3), ("red", "pick", 3)]
    + [("red", "ban", 4), ("blue", "ban", 4), ("red", "ban", 5), ("blue", "ban", 5)]
    + [("red", "pick", 4), ("blue", "pick", 4), ("blue", "pick", 5), ("red", "pick", 5)]
)  # fmt: skip
FIELDS = [
    "SG.GameId=game", "SG.MatchId=match", "SG.OverviewPage=page", "SG.DateTime_UTC=dt", "SG.Team1=blue",
    "SG.Team2=red", "SG.WinTeam=winner", "SG.Patch=patch", "SG.N_GameInMatch=n", "SG.Gamelength_Number=minutes",
    "SG.Team1Players=bplayers", "SG.Team2Players=rplayers", "SG.Team1Picks=bpicks", "SG.Team2Picks=rpicks",
    "PB.Team1=pb1", "PB.Team2=pb2",
] + [f"PB.Team{t}{a}{i}=t{t}{a.lower()}{i}" for t in (1, 2) for a in ("Ban", "Pick") for i in range(1, 6)]  # fmt: skip


def fetch(
    raw_path: Path, refresh: bool = False, fetcher: Any = _http_fetch
) -> list[dict[str, str]]:
    """Every professional game since SINCE in the leagues above, with its draft (cached as raw JSON)."""
    if raw_path.is_file() and not refresh:
        return json.loads(raw_path.read_text())
    rows: list[dict[str, str]] = []
    offset = 0
    while True:
        data = fetcher(
            {
                "action": "cargoquery",
                "tables": "ScoreboardGames=SG,PicksAndBansS7=PB",
                "join_on": "SG.GameId=PB.GameId",
                "fields": ",".join(FIELDS),
                "where": f'SG.DateTime_UTC >= "{SINCE}" AND ({" OR ".join(LEAGUES)})',
                "order_by": "SG.DateTime_UTC",
                "limit": "500",
                "offset": str(offset),
            }
        )
        batch = [r["title"] for r in data.get("cargoquery", [])]
        rows += batch
        if len(batch) < 500:
            break
        offset += 500
        time.sleep(2.0)
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(json.dumps(rows))
    return rows


def _split(value: str | None) -> list[str]:
    return [v.strip() for v in (value or "").split(",")]


def _display(player: str) -> str:
    """Leaguepedia disambiguates pages ("Zeka (Kim Geon-woo)"); show the in-game name."""
    return player.split(" (")[0].strip()


def _event(page: str) -> tuple[str, str]:
    parts = page.split("/")
    if "Mid-Season Invitational" in page:
        league = "MSI"
    elif "World Championship" in page:
        league = "Worlds"
    elif page.startswith("First Stand"):
        league = "First Stand"
    else:
        league = parts[0]
    return f"{league} - {' '.join(parts[1:]) or parts[0]}", league


def build(rows: list[dict[str, str]], data_dir: Path, cache_dir: Path) -> dict[str, int]:
    """Write the Lockout cache tables (``cache_dir/lol``) and team names (``data_dir/meta``)."""
    draft: list[dict[str, Any]] = []
    games: list[dict[str, Any]] = []
    players: list[dict[str, Any]] = []
    series_len: Counter[str] = Counter()
    skipped = 0
    for r in rows:
        series_len[r["match"]] = max(series_len[r["match"]], int(r.get("n") or 1))
    for r in rows:
        blue, red, winner = r.get("blue"), r.get("red"), r.get("winner")
        if not blue or not red or winner not in (blue, red):
            skipped += 1
            continue
        # PicksAndBans lists the match's team 1 first; when it played red, its fields are the red side
        pb_side = {"1": "blue", "2": "red"} if r.get("pb1") == blue else {"1": "red", "2": "blue"}
        if {r.get("pb1"), r.get("pb2")} != {blue, red}:
            skipped += 1
            continue
        steps: dict[tuple[str, str, int], str] = {}
        for t in ("1", "2"):
            for a in ("ban", "pick"):
                for i in range(1, 6):
                    champ = (r.get(f"t{t}{a}{i}") or "").strip()
                    if champ and champ.lower() not in ("none", "loss of ban"):
                        steps[(pb_side[t], a, i)] = champ
        roster: dict[str, dict[str, tuple[str, str]]] = {}
        for side, ps, cs in (("blue", "bplayers", "bpicks"), ("red", "rplayers", "rpicks")):
            names, champs = _split(r.get(ps)), _split(r.get(cs))
            roster[side] = {
                c: (names[k] if k < len(names) else "", ROLES[k]) for k, c in enumerate(champs[:5])
            }
        if sum(1 for k in steps if k[1] == "pick") < 10:
            skipped += 1
            continue
        event, league = _event(r["page"])
        started = (r.get("dt") or "").replace(" ", "T") + "Z"
        team_of = {"blue": blue, "red": red}
        for seq, key in enumerate(ORDER, 1):
            champ = steps.get(key)
            if champ is None:
                continue
            side, action, _ = key
            player, role = roster[side].get(champ, ("", None)) if action == "pick" else ("", None)
            draft.append(
                {
                    "game_id": r["game"], "series_id": r["match"], "game_number": int(r.get("n") or 1),
                    "series_games": series_len[r["match"]], "event": event, "league": league,
                    "patch": r.get("patch") or "", "started_at": started, "team_id": team_of[side],
                    "side": side, "action": action, "seq": seq,
                    "phase": "ban1" if seq <= 6 else "pick1" if seq <= 12 else "ban2" if seq <= 16 else "pick2",
                    "champion": champ, "player_id": player or None, "role": role,
                    "won": team_of[side] == winner,
                }
            )  # fmt: skip
        games.append(
            {
                "series_id": r["match"], "game_id": r["game"], "game_number": int(r.get("n") or 1),
                "duration_s": int(float(r.get("minutes") or 0) * 60), "winner_team_id": winner,
                "blue_team_id": blue, "red_team_id": red, "blue_name": blue, "red_name": red,
                "n_draft_actions": len(steps),
            }
        )  # fmt: skip
        for k, side in enumerate(("blue", "red")):
            for slot, (champ, (player, role)) in enumerate(roster[side].items()):
                players.append(
                    {"game_id": r["game"], "slot": k * 5 + slot, "player_id": player, "name": _display(player),
                     "team_id": team_of[side], "side": side, "role": role, "champion": champ}
                )  # fmt: skip
    lol = cache_dir / "lol"
    lol.mkdir(parents=True, exist_ok=True)
    (lol / "tracks").mkdir(exist_ok=True)
    pq.write_table(pa.Table.from_pylist(draft), lol / "draft_enriched.parquet")
    pq.write_table(pa.Table.from_pylist(games), lol / "games.parquet")
    pq.write_table(pa.Table.from_pylist(players), lol / "players.parquet")
    _empty_tables(lol)
    _meta(data_dir, games)
    return {"games": len(games), "draft_actions": len(draft), "skipped": skipped}


def _empty_tables(lol: Path) -> None:
    """Position-based tables do not exist in public data; write them empty with the columns queries expect."""
    s = pa.string()
    schemas = {
        "roles": {"game_id": s, "slot": pa.int64(), "role": s, "confidence": s},
        "events": {"game_id": s, "seq": pa.int64(), "t": pa.float64(), "kind": s, "name": s},
        "jungle": {"game_id": s, "slot": pa.int64(), "side": s, "team_id": s, "player_id": s, "route": s,
                   "start_side": s, "first_lane": s, "first_lane_t": pa.float64(), "buff_start": s},
        "objectives": {"game_id": s, "team_id": s},
        "tells": {"team_id": s, "template_id": s},
        "tell_evidence": {"team_id": s, "template_id": s, "game_id": s},
    }  # fmt: skip
    for name, cols in schemas.items():
        pq.write_table(
            pa.table({c: pa.array([], type=t) for c, t in cols.items()}), lol / f"{name}.parquet"
        )


def _meta(data_dir: Path, games: list[dict[str, Any]]) -> None:
    meta = data_dir / "meta"
    meta.mkdir(parents=True, exist_ok=True)
    (data_dir / "lol").mkdir(exist_ok=True)
    teams = sorted({g["blue_team_id"] for g in games} | {g["red_team_id"] for g in games})
    by_team: dict[str, int] = defaultdict(int)
    for g in games:
        by_team[g["blue_team_id"]] += 1
        by_team[g["red_team_id"]] += 1
    with (meta / "teams.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "title",
                "team_id",
                "name",
                "other_names",
                "series_count",
                "events",
                "first_seen",
                "last_seen",
            ]
        )
        for t in teams:
            w.writerow(["lol", t, t, "", by_team[t], "", "", ""])
    with (meta / "rosters.csv").open("w", newline="") as fh:
        csv.writer(fh).writerow(
            ["title", "series_id", "game_id", "team_id", "player_id", "player_name"]
        )
