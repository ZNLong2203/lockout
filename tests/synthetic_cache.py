"""A tiny SYNTHETIC cache for the API tests. Nothing here comes from the licensed GRID data.

World: three teams, 15 games.

* ``t1`` (Alpha Team) and ``t2`` (Bravo Team) play six best-of-2 series (12 games); ``t3`` (Charlie Team)
  plays one best-of-3 against ``t2`` (3 games), so it has too few games for a profile.
* Series 1-4 belong to "Alpha Cup - Split 1" (8 games), series 5-7 to "Beta Cup - Split 2" (7 games).
  ``t1`` therefore has 8 games in the first event and only 4 in the second.
* Each role has four champions per team and a series uses two of them (Fearless: no repeats in a series).
* ``t1`` bans "Poppy" in every game, so it shows up as a distinctive ban.
* Series 7 has no stored positions, so its replays 404; one player of game ``g01`` has no champion.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from lockout.config import Settings

ROLES = ("top", "jungle", "mid", "adc", "support")
TEAMS = {"t1": "Alpha Team", "t2": "Bravo Team", "t3": "Charlie Team"}
LETTER = {"t1": "A", "t2": "B", "t3": "C"}
EVENT_A, EVENT_B = "Alpha Cup - Split 1", "Beta Cup - Split 2"
# (series number, blue team of game 1, other team, games, event)
SERIES = [(i, "t1", "t2", 2, EVENT_A if i <= 4 else EVENT_B) for i in range(1, 7)] + [
    (7, "t3", "t2", 3, EVENT_B)
]
NO_POSITIONS_SERIES = "s7"
NO_CHAMPION = ("g01", "t1-support")
PICK_SEQS = (7, 8, 9, 10, 11, 12, 17, 18, 19, 20)
BAN_SEQS = (1, 2, 3, 4, 5, 6)


def champion(team: str, role: str, series_no: int, game_in_series: int) -> str:
    return f"{role.capitalize()}{LETTER[team]}{(2 * (series_no - 1) + game_in_series) % 4}"


def _write(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(rows), path)


def build_synthetic_cache(root: Path) -> Settings:
    cache = root / "cache" / "lol"
    meta = root / "data" / "meta"
    (root / "data" / "lol").mkdir(parents=True)
    meta.mkdir(parents=True)

    games, players, roles, events, draft, jungle, objectives = [], [], [], [], [], [], []
    tracks: dict[str, list[dict[str, object]]] = {}
    rosters: list[dict[str, str]] = []
    game_no = 0
    for series_no, first_blue, other, n_games, event in SERIES:
        series_id = f"s{series_no}"
        for g in range(n_games):
            game_no += 1
            gid = f"g{game_no:02d}"
            blue, red = (first_blue, other) if g % 2 == 0 else (other, first_blue)
            winner = first_blue if g % 2 == 0 else other
            started = f"2026-01-{game_no:02d}T10:00:00Z"
            games.append(
                {
                    "series_id": series_id, "game_id": gid, "game_number": g + 1,
                    "duration_s": 1800 + 10 * game_no, "winner_team_id": winner,
                    "blue_team_id": blue, "red_team_id": red,
                    "blue_name": TEAMS[blue], "red_name": TEAMS[red], "n_draft_actions": 16,
                }
            )  # fmt: skip
            sides = {blue: "blue", red: "red"}
            for slot in range(10):
                team = blue if slot < 5 else red
                role = ROLES[slot % 5]
                pid = f"{team}-{role}"
                players.append(
                    {"game_id": gid, "slot": slot, "player_id": pid, "name": f"{TEAMS[team]} {role}",
                     "team_id": team, "side": sides[team]}
                )  # fmt: skip
                roles.append({"game_id": gid, "slot": slot, "role": role, "confidence": "high"})
                champ = "" if (gid, pid) == NO_CHAMPION else champion(team, role, series_no, g)
                rosters.append(
                    {"title": "lol", "series_id": series_id, "game_id": gid, "game_number": str(g + 1),
                     "team_id": team, "team_name": TEAMS[team], "side": sides[team], "player_id": pid,
                     "player_name": f"{TEAMS[team]} {role}", "character_id": "", "character_name": champ,
                     "participation_status": "started"}
                )  # fmt: skip
                if series_id != NO_POSITIONS_SERIES:
                    tracks.setdefault(series_id, []).extend(
                        {"game_id": gid, "t": t, "slot": slot, "x": 1000 + 100 * slot + 10 * t,
                         "y": 2000 + 50 * slot + 5 * t, "age": 0}
                        for t in range(10)
                    )  # fmt: skip

            seqs = iter(PICK_SEQS)
            ban_seqs = iter(BAN_SEQS)
            for i in range(10):  # picks alternate between the teams
                team = blue if i % 2 == 0 else red
                role = ROLES[i // 2]
                seq = next(seqs)
                draft.append(_draft_row(gid, series_no, g, n_games, event, started, team, sides, "pick", seq,
                                        champion(team, role, series_no, g), f"{team}-{role}", role,
                                        team == winner))  # fmt: skip
            for i in range(6):  # three bans each: t1 always bans Poppy
                team = blue if i % 2 == 0 else red
                banned = "Poppy" if (team == "t1" and i < 2) else f"Ban{(game_no + i) % 5}"
                draft.append(_draft_row(gid, series_no, g, n_games, event, started, team, sides, "ban",
                                        next(ban_seqs), banned, None, None, team == winner))  # fmt: skip

            for team in (blue, red):
                jg_slot = (0 if team == blue else 5) + 1
                top_side = team == "t1"
                jungle.append(
                    {"game_id": gid, "slot": jg_slot, "side": sides[team], "team_id": team,
                     "player_id": f"{team}-jungle",
                     "route": "blue_buff>gromp>wolves>raptors>red_buff>krugs" if top_side
                     else "red_buff>krugs>raptors>wolves>gromp>blue_buff",
                     "n_camps": 6, "first_camp": "blue_buff" if top_side else "red_buff",
                     "start_side": "top" if top_side else "bot", "buff_start": True,
                     "t_first_camp": 90, "t_clear_end": 330, "visit_times": "",
                     "first_lane": "top" if (top_side and game_no % 2) else "mid",
                     "first_lane_t": 180 + game_no}
                )  # fmt: skip
                for objective, t_kill in (("dragon", 600), ("baron", 1500)):
                    killer = team == winner
                    objectives.append(
                        {"game_id": gid, "objective": objective, "name": f"{objective}-1",
                         "t_kill": t_kill, "t_spawn": t_kill - 20, "since_spawn": 20,
                         "side": sides[team], "team_id": team, "is_killer": killer,
                         "n_m60": 2, "n_m30": 4 if killer else 2, "n_m15": 4, "n_m5": 4, "n_pit_m5": 3,
                         "setup_s": 40 if killer else 10, "opp_n_m10": 1,
                         "n_spawn_m15": 3, "n_spawn_0": 3 if killer else 1}
                    )  # fmt: skip

            blue_top, red_top, blue_jg = 0, 5, 1
            for seq, (t, kind, name, actor, target, target_id, x, y) in enumerate(
                [
                    (5, "kill", "kill", blue_top, red_top, None, 3000, 3000),
                    (600, "objective", "dragon", blue_jg, None, "dragon-1", 10020, 4790),
                    (700, "structure", "turret", blue_top, None, "red-turret-top-1", 11000, 13000),
                    (
                        30,
                        "purchase",
                        "Doran's Blade",
                        blue_top,
                        None,
                        "1055",
                        None,
                        None,
                    ),  # not a replay event
                ]
            ):
                events.append(
                    {"game_id": gid, "seq": seq, "t": t, "kind": kind, "name": name,
                     "actor_pid": f"{blue}-{ROLES[actor % 5]}",
                     "target_pid": None if target is None else f"{red}-{ROLES[target % 5]}",
                     "target_id": target_id, "x": x, "y": y, "assists": None}
                )  # fmt: skip

    tells, evidence = [], []
    for team, tid, n, hits, strength, q in (
        ("t1", "tell_a", 8, 7, "strong", 0.01),
        ("t1", "tell_b", 8, 4, "typical", 0.9),
        ("t2", "tell_a", 12, 6, "typical", 0.8),
    ):
        tells.append(
            {"team_id": team, "template_id": tid, "group": "objectives", "title": f"does {tid}",
             "n": n, "hits": hits, "rate": hits / n, "shrunk_rate": (hits + 5) / (n + 10),
             "baseline": 0.5, "baseline_n": 40, "ci_lo": 0.3, "ci_hi": 0.95, "p": q / 2, "q": q,
             "strength": strength, "direction": "above" if hits / n > 0.5 else "below"}
        )  # fmt: skip
        team_games = [g for g in games if team in (g["blue_team_id"], g["red_team_id"])]
        for i, g in enumerate(team_games[:n]):
            evidence.append(
                {"team_id": team, "template_id": tid, "game_id": g["game_id"],
                 "t_trigger": 300 + i, "hit": i < hits, "t_outcome": 360 + i if i < hits else None}
            )  # fmt: skip

    for name, rows in (
        ("games", games), ("players", players), ("roles", roles), ("events", events),
        ("draft_enriched", draft), ("jungle", jungle), ("objectives", objectives),
        ("tells", tells), ("tell_evidence", evidence),
    ):  # fmt: skip
        _write(cache / f"{name}.parquet", rows)
    for series_id, rows in tracks.items():
        table = pa.Table.from_pylist(rows).cast(
            pa.schema(
                [
                    ("game_id", pa.string()),
                    ("t", pa.int16()),
                    ("slot", pa.int8()),
                    ("x", pa.int16()),
                    ("y", pa.int16()),
                    ("age", pa.uint8()),
                ]
            )  # fmt: skip
        )
        path = cache / "tracks" / f"{series_id}.parquet"
        path.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(table, path)
    (cache / "tracks").mkdir(exist_ok=True)

    (cache / "draft_backtest.json").write_text(json.dumps(_backtest()), encoding="utf-8")
    _csv(meta / "teams.csv", ["title", "team_id", "name", "other_names", "series_count", "events",
                              "first_seen", "last_seen"],
         [{"title": "lol", "team_id": t, "name": n, "other_names": "", "series_count": "3",
           "events": "", "first_seen": "", "last_seen": ""} for t, n in TEAMS.items()]
         + [{"title": "val", "team_id": "v1", "name": "Valorant Team", "other_names": "",
             "series_count": "1", "events": "", "first_seen": "", "last_seen": ""}])  # fmt: skip
    _csv(meta / "rosters.csv", list(rosters[0]), rosters)
    return Settings(data_dir=root / "data", cache_dir=root / "cache")


def _draft_row(
    gid, series_no, g, n_games, event, started, team, sides, action, seq, champ, pid, role, won
):  # type: ignore[no-untyped-def]
    return {
        "game_id": gid, "series_id": f"s{series_no}", "game_number": g + 1, "series_games": n_games,
        "event": event, "league": event.split(" - ")[0], "patch": "26.1", "started_at": started,
        "team_id": team, "side": sides[team], "action": action, "seq": seq,
        "phase": "ban1" if seq <= 6 else "pick1" if seq <= 12 else "ban2" if seq <= 16 else "pick2",
        "champion": champ, "player_id": pid, "role": role, "won": won,
    }  # fmt: skip


def _csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _backtest() -> dict[str, object]:
    return {
        "depletion": [{"game_number": 2, "team_games": 12, "mean_stress": 0.6}],
        "buckets": [{"label": "critical", "n": 10, "wins": 4, "win_rate": 0.4, "ci_lo": 0.17, "ci_hi": 0.69}],
        "pairwise": {"n": 20, "wins": 11, "rate": 0.55, "ci_lo": 0.34, "ci_hi": 0.74, "p_value": 0.4},
        "calibration": [{"game_number": 2, "series": 6, "simulated": 0.6, "actual": 0.58, "actual_n": 12}],
        "weakest_role_share": {role: 0.2 for role in ROLES},
        "pick_depth": [
            {"game_number": 1, "picks": 30, "mean_rank": 1.5, "share_top3": 0.9, "share_new": 0.0},
            {"game_number": 2, "picks": 30, "mean_rank": 2.5, "share_top3": 0.7, "share_new": 0.1},
        ],
        "caveats": ["Synthetic numbers for tests."],
    }  # fmt: skip
