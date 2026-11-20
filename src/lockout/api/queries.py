"""Read-only queries behind the HTTP API.

Everything is read from the local Parquet cache with DuckDB and mapped onto the models in
:mod:`lockout.api.schemas`. The maths lives elsewhere (``lockout.draft``, ``lockout.detectors``): this
module only selects, joins and reshapes. In particular tell statistics are read from ``tells.parquet``, never
recomputed here.

The cache is derived from licensed data; nothing in this module writes or exports it.
"""

from __future__ import annotations

import csv
import json
import statistics
import threading
from collections import Counter
from collections.abc import Callable
from dataclasses import asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Literal

import duckdb
import numpy as np

from lockout.api import schemas as s
from lockout.config import Settings
from lockout.detectors.tells import wilson_interval
from lockout.draft.planner import PickIndex, SeriesPlan, TeamState, jungle_bridge, plan_series
from lockout.draft.pools import pool_weights
from lockout.draft.tendencies import (
    MIN_TEAM_GAMES,
    DraftRow,
    TendencyReport,
    load_draft_rows,
    tendency_report,
)
from lockout.geometry import MAP_BOUNDS

#: tables the API needs; ``lockout etl``, ``detect`` and ``draft-build`` write them
REQUIRED_TABLES = (
    "games",
    "players",
    "roles",
    "events",
    "draft_enriched",
    "jungle",
    "objectives",
    "tells",
    "tell_evidence",
)
MIN_PROFILE_GAMES = MIN_TEAM_GAMES  # a profile needs at least this many games, else 404
# jungle routes are grouped by their first camps: full routes are almost all unique
ROUTE_PREFIX = 3
ROUTES_SHOWN = 6
EXAMPLE_GAMES = 3
POOL_SHOWN = 8  # champions per player in the draft room context
REMAINING_SHOWN = 15  # champions per role in a plan
BRIDGE_CHAMPIONS = 5  # remaining jungle champions that get a macro bridge in a plan
RECENT_GAMES = 5
REPLAY_EVENT_KINDS = ("kill", "objective", "structure", "spawn", "respawn")
OBJECTIVES = ("dragon", "baron", "herald", "grubs")
MIN_PREPOSITIONED = 3  # players in place at spawn that count as "pre-positioned"
ROLE_ORDER = ("top", "jungle", "mid", "adc", "support")


class NotFoundError(LookupError):
    """Something the caller asked for does not exist (or has too little data); served as HTTP 404."""


class CacheNotReadyError(RuntimeError):
    """The cache or the team names are missing; the server refuses to start with a clear message."""


def check_ready(settings: Settings) -> None:
    cache = settings.cache_dir / "lol"
    missing = [f"{t}.parquet" for t in REQUIRED_TABLES if not (cache / f"{t}.parquet").exists()]
    if not (cache / "tracks").is_dir():
        missing.append("tracks/")
    if missing:
        raise CacheNotReadyError(
            f"Cache incomplete at {cache} (missing: {', '.join(missing)}). "
            "Run `lockout etl`, `lockout detect` and `lockout draft-build`, "
            "or point LOCKOUT_CACHE_DIR at a finished cache."
        )
    absent = [f for f in ("teams.csv", "rosters.csv") if not (settings.meta_dir / f).exists()]
    if absent:
        raise CacheNotReadyError(
            f"Team and champion names not found: {', '.join(absent)} missing under "
            f"{settings.meta_dir}. Set STL_DATA_DIR to your clone of the data repo."
        )


def _lit(value: str | Path) -> str:
    """A SQL string literal (the paths we interpolate are our own, but never trust a quote)."""
    return "'" + str(value).replace("'", "''") + "'"


def _day(started_at: str | None) -> str:
    return (started_at or "")[:10]


def _short(name: str) -> str:
    words = name.split()
    return (name[:3] if len(words) < 2 else "".join(w[0] for w in words[:3])).upper()


class Repository:
    """One instance per server. Every query opens its own in-memory DuckDB connection, so requests are
    independent and safe to run in FastAPI's thread pool."""

    def __init__(self, settings: Settings) -> None:
        check_ready(settings)
        self.settings = settings
        self.cache = settings.cache_dir / "lol"
        self._lock = threading.Lock()
        self._memo: dict[str, Any] = {}
        self.names = self._load_names()

    # -- plumbing ---------------------------------------------------------------------------------

    def _table(self, name: str) -> str:
        return f"read_parquet({_lit(self.cache / f'{name}.parquet')})"

    def _rows(self, sql: str, params: list[Any] | None = None) -> list[tuple[Any, ...]]:
        con = duckdb.connect()
        try:
            return con.execute(sql, params or []).fetchall()
        finally:
            con.close()

    def _memoised(self, key: str, build: Callable[[], Any]) -> Any:
        with self._lock:
            if key not in self._memo:
                self._memo[key] = build()
            return self._memo[key]

    def _scope(self, event: str | None, column: str = "game_id") -> tuple[str, list[Any]]:
        """SQL ``and`` clause (and parameters) restricting ``column`` to the games of one event."""
        if not event:
            return "", []
        return (
            f" and {column} in (select game_id from {self._table('draft_enriched')} where event = ?)",
            [event],
        )

    def _load_names(self) -> dict[str, str]:
        fallback = {
            tid: name
            for tid, name in self._rows(
                f"""select blue_team_id, blue_name from {self._table("games")}
                    union select red_team_id, red_name from {self._table("games")}"""
            )
            if tid and name
        }
        with (self.settings.meta_dir / "teams.csv").open(encoding="utf-8") as fh:
            named = {r["team_id"]: r["name"] for r in csv.DictReader(fh) if r["title"] == "lol"}
        return {**fallback, **named}

    @property
    def index(self) -> PickIndex:
        return self._memoised("index", lambda: PickIndex.load(self.cache))

    @property
    def draft_rows(self) -> list[DraftRow]:
        return self._memoised("draft_rows", lambda: load_draft_rows(self.cache))

    @property
    def player_names(self) -> dict[str, str]:
        def build() -> dict[str, str]:
            rows = self._rows(
                f"""select p.player_id, arg_max(p.name, g.started_at)
                    from {self._table("players")} p
                    left join (select distinct game_id, started_at from {self._table("draft_enriched")}) g
                      using (game_id)
                    group by 1"""
            )
            return {pid: name for pid, name in rows if name}

        return self._memoised("player_names", build)

    def resolve(self, query: str) -> tuple[str, str]:
        hit = self.index.find_team(self.names, query)
        if hit is None:
            raise NotFoundError(f"No team with draft history matches '{query}'.")
        return hit

    def _name(self, team_id: str | None) -> str:
        return self.names.get(team_id or "", team_id or "")

    # -- health and teams ---------------------------------------------------------------------------

    def health(self) -> s.Health:
        (games,) = self._rows(f"select count(*) from {self._table('games')}")[0]
        return s.Health(status="ok", games=int(games))

    def _events_by_team(self) -> dict[str, list[str]]:
        rows = self._rows(
            f"""with t as (
                  select blue_team_id as team_id, game_id from {self._table("games")}
                  union all select red_team_id, game_id from {self._table("games")})
                select t.team_id, e.event from t
                join (select distinct game_id, event from {self._table("draft_enriched")}) e using (game_id)
                where e.event is not null group by 1, 2 order by 1, 2"""
        )
        out: dict[str, list[str]] = {}
        for tid, event in rows:
            out.setdefault(tid, []).append(event)
        return out

    def _summaries(self, event: str | None) -> dict[str, s.TeamSummary]:
        scope, params = self._scope(event, "t.game_id")
        rows = self._rows(
            f"""with t as (
                  select blue_team_id as team_id, game_id from {self._table("games")}
                  union all select red_team_id, game_id from {self._table("games")})
                select t.team_id, count(*), min(e.started_at), max(e.started_at)
                from t left join (select distinct game_id, started_at from {self._table("draft_enriched")}) e
                  using (game_id)
                where t.team_id is not null {scope} group by 1""",
            params,
        )
        events = self._events_by_team()
        return {
            tid: s.TeamSummary(
                team_id=tid,
                name=self._name(tid),
                games=int(n),
                first_seen=_day(first),
                last_seen=_day(last),
                events=events.get(tid, []),
            )
            for tid, n, first, last in rows
        }

    def teams(self, q: str = "", event: str | None = None) -> list[s.TeamSummary]:
        needle = q.strip().lower()
        found = [
            t for t in self._summaries(event).values() if needle in t.name.lower()
        ]  # an empty needle matches every name
        return sorted(found, key=lambda t: (-t.games, t.name.lower()))

    # -- scouting profile -----------------------------------------------------------------------------

    def team_profile(self, team_id: str, event: str | None = None) -> s.TeamProfile:
        summary = self._summaries(event).get(team_id)
        if summary is None or summary.games < MIN_PROFILE_GAMES:
            name = self.names.get(team_id)
            if name is None:
                raise NotFoundError(f"No team with id '{team_id}'.")
            where = f" in '{event}'" if event else ""
            have = summary.games if summary else 0
            raise NotFoundError(
                f"{name} has {have} game(s){where}; a profile needs at least {MIN_PROFILE_GAMES}."
            )
        # `games` and the date range follow the event filter; `events` stays complete so a UI can offer them
        notes = [
            "Jungle routes group the first three camps in order of first detected contact; "
            "the feed has no camp-clear events, so this is where the jungler was seen, not what was cleared.",
            "Positions arrive every 1-10 s, so timings are good to about 5 s.",
        ]
        if event:
            notes.append(
                f"Jungle and objective figures are restricted to '{event}'. Tells are computed once over "
                "all of the team's games and are not filtered by event."
            )
        return s.TeamProfile(
            team=summary,
            jungle=self._jungle_profile(team_id, event),
            objectives=self._objective_profiles(team_id, event),
            tells=self._tells(team_id),
            notes=notes,
        )

    def _jungle_profile(self, team_id: str, event: str | None) -> s.JungleProfile | None:
        scope, params = self._scope(event, "j.game_id")
        rows = self._rows(
            f"""select j.game_id, j.route, j.start_side, j.first_lane, j.first_lane_t
                from {self._table("jungle")} j
                left join (select distinct game_id, started_at from {self._table("draft_enriched")}) e
                  using (game_id)
                where j.team_id = ? {scope} order by e.started_at desc nulls last, j.game_id""",
            [team_id, *params],
        )
        if not rows:
            return None
        games = len(rows)
        prefixes: Counter[str] = Counter()
        examples: dict[str, list[str]] = {}
        for game_id, route, *_ in rows:
            camps = (route or "").split(">") if route else []
            if len(camps) >= ROUTE_PREFIX:
                key = ">".join(camps[:ROUTE_PREFIX])
                prefixes[key] += 1
                examples.setdefault(key, []).append(game_id)
        with_route = sum(prefixes.values())
        routes = [
            s.RouteShare(
                route=route,
                n=n,
                share=n / with_route,
                example_game_ids=examples[route][:EXAMPLE_GAMES],
            )
            for route, n in prefixes.most_common(ROUTES_SHOWN)
        ]
        starts = Counter(r[2] for r in rows if r[2])
        n_start = sum(starts.values())
        lanes = ("top", "mid", "bot")
        first_lane_t: dict[str, list[int]] = {lane: [] for lane in lanes}
        for r in rows:
            if r[3] in first_lane_t and r[4] is not None:
                first_lane_t[r[3]].append(int(r[4]))
        return s.JungleProfile(
            games=games,
            routes=routes,
            start_side={k: (starts[k] / n_start if n_start else 0.0) for k in ("top", "bot")},
            first_lane={lane: sum(1 for r in rows if r[3] == lane) / games for lane in lanes},
            median_first_lane_t={
                lane: (int(statistics.median(ts)) if ts else None)
                for lane, ts in first_lane_t.items()
            },
        )

    def _objective_profiles(self, team_id: str, event: str | None) -> list[s.ObjectiveProfile]:
        scope, params = self._scope(event, "game_id")
        k = MIN_PREPOSITIONED
        rows = self._rows(
            f"""select objective,
                  count(*) filter (where team_id = ? and is_killer),
                  avg(n_m30) filter (where team_id = ? and is_killer),
                  avg(n_m30) filter (where is_killer),
                  median(setup_s) filter (where team_id = ? and is_killer),
                  count(*) filter (where team_id = ? and n_spawn_0 >= {k}),
                  count(*) filter (where team_id = ? and n_spawn_0 >= {k} and is_killer),
                  count(*) filter (where n_spawn_0 >= {k}),
                  count(*) filter (where n_spawn_0 >= {k} and is_killer)
                from {self._table("objectives")} where true {scope} group by objective""",
            [team_id] * 5 + params,
        )
        by_objective = {r[0]: r for r in rows}
        out: list[s.ObjectiveProfile] = []
        for objective in OBJECTIVES:
            row = by_objective.get(objective)
            if row is None or not row[1]:
                continue
            _, taken, mean30, league30, median_setup, pre_n, pre_hits, lg_n, lg_hits = row
            secure = None
            if pre_n:
                lo, hi = wilson_interval(int(pre_hits), int(pre_n))
                secure = s.Rate(
                    n=int(pre_n),
                    hits=int(pre_hits),
                    rate=pre_hits / pre_n,
                    ci_lo=lo,
                    ci_hi=hi,
                    baseline=(lg_hits / lg_n) if lg_n else None,
                )
            out.append(
                s.ObjectiveProfile(
                    objective=objective,
                    taken=int(taken),
                    mean_players_m30_when_taken=float(mean30 or 0.0),
                    league_mean_players_m30=float(league30 or 0.0),
                    median_setup_s=float(median_setup or 0.0),
                    prepositioned_secure=secure,
                )
            )
        return out

    def _tells(self, team_id: str) -> list[s.Tell]:
        rows = self._rows(
            f"""select template_id, "group", title, n, hits, rate, shrunk_rate, baseline, ci_lo, ci_hi,
                       q, strength, direction
                from {self._table("tells")} where team_id = ? order by q, template_id""",
            [team_id],
        )
        return [
            s.Tell(
                template_id=tid,
                group=group,
                title=title,
                rate=s.Rate(n=int(n), hits=int(hits), rate=rate, ci_lo=lo, ci_hi=hi, baseline=base),
                shrunk_rate=shrunk,
                q=q,
                strength=strength,
                direction=direction,
            )
            for tid, group, title, n, hits, rate, shrunk, base, lo, hi, q, strength, direction in rows
        ]

    def tell_evidence(self, team_id: str, template_id: str) -> list[s.EvidenceItem]:
        if team_id not in self.names:
            raise NotFoundError(f"No team with id '{team_id}'.")
        rows = self._rows(
            f"""select ev.game_id, g.series_id, d.started_at, g.blue_team_id, g.red_team_id,
                       ev.t_trigger, ev.hit, ev.t_outcome
                from {self._table("tell_evidence")} ev
                join {self._table("games")} g using (game_id)
                left join (select distinct game_id, started_at from {self._table("draft_enriched")}) d
                  using (game_id)
                where ev.team_id = ? and ev.template_id = ?
                order by d.started_at desc nulls last, ev.game_id, ev.t_trigger desc""",
            [team_id, template_id],
        )
        if not rows:
            raise NotFoundError(f"No evidence for tell '{template_id}' of {self._name(team_id)}.")
        items = []
        for game_id, series_id, started, blue, red, t_trigger, hit, t_outcome in rows:
            ours_blue = blue == team_id
            items.append(
                s.EvidenceItem(
                    game_id=game_id,
                    series_id=series_id,
                    date=_day(started),
                    opponent=self._name(red if ours_blue else blue),
                    side="blue" if ours_blue else "red",
                    t_trigger=int(t_trigger),
                    hit=bool(hit),
                    t_outcome=None if t_outcome is None else int(t_outcome),
                )
            )
        return items

    # -- replay -------------------------------------------------------------------------------------------

    def replay(self, game_id: str) -> s.Replay:
        games = self._rows(
            f"""select series_id, duration_s, winner_team_id, blue_team_id, red_team_id, game_number
                from {self._table("games")} where game_id = ?""",
            [game_id],
        )
        if not games:
            raise NotFoundError(f"No game '{game_id}'.")
        series_id, duration_s, winner, blue, red, game_number = games[0]
        context = self._rows(
            f"""select any_value(event), any_value(started_at) from {self._table("draft_enriched")}
                where game_id = ?""",
            [game_id],
        )
        event, started_at = context[0] if context else (None, None)
        shard = self.cache / "tracks" / f"{series_id}.parquet"
        if not shard.exists():
            raise NotFoundError(f"No positions stored for game '{game_id}'.")

        players = self._rows(
            f"""select slot, player_id, name, side from {self._table("players")}
                where game_id = ? order by slot""",
            [game_id],
        )
        roles = dict(
            self._rows(
                f"select slot, role from {self._table('roles')} where game_id = ? and slot >= 0",
                [game_id],
            )
        )
        champions = dict(
            self._rows(
                f"""select player_id, character_name
                    from read_csv({_lit(self.settings.meta_dir / "rosters.csv")}, all_varchar = true)
                    where title = 'lol' and game_id = ? and character_name <> ''""",
                [game_id],
            )
        )
        slot_of = {pid: int(slot) for slot, pid, _, _ in players}
        track = self._rows(
            f"select t, slot, x, y from read_parquet({_lit(shard)}) where game_id = ?", [game_id]
        )
        if not track:
            raise NotFoundError(f"No positions stored for game '{game_id}'.")
        length = max(int(t) for t, *_ in track) + 1
        grid = np.full((length, 10, 2), -1, dtype=np.int32)
        for t, slot, x, y in track:
            grid[int(t), int(slot)] = (x, y)

        events = [
            s.ReplayEvent(
                t=int(t),
                kind=kind,
                name=name or "",
                slot=slot_of.get(actor),
                target_slot=slot_of.get(target),
                x=x,
                y=y,
            )
            for t, kind, name, actor, target, x, y in self._rows(
                f"""select t, kind, name, actor_pid, target_pid, x, y from {self._table("events")}
                    where game_id = ? and kind in ({", ".join(_lit(k) for k in REPLAY_EVENT_KINDS)})
                    order by t, seq""",
                [game_id],
            )
        ]
        return s.Replay(
            game_id=game_id,
            series_id=series_id,
            duration_s=int(duration_s),
            bounds=MAP_BOUNDS,
            players=[
                s.ReplayPlayer(
                    slot=int(slot),
                    player_id=pid,
                    name=name,
                    side=side,
                    role=roles.get(slot, "unknown"),
                    champion=champions.get(pid),
                )
                for slot, pid, name, side in players
            ],
            positions=grid.tolist(),
            events=events,
            blue_team=self._name(blue),
            red_team=self._name(red),
            winner_side="blue" if winner == blue else "red" if winner == red else None,
            event=event,
            started_at=started_at,
            game_number=int(game_number) if game_number is not None else None,
        )

    # -- draft ----------------------------------------------------------------------------------------------

    def _bridge(self, champion: str, team_id: str | None) -> s.JungleBridge | None:
        """The team's own numbers when it has played the champion, the league's otherwise."""
        if team_id and (found := jungle_bridge(self.cache, champion, team_id)):
            return s.JungleBridge(**found, scope="team")
        if found := jungle_bridge(self.cache, champion):
            return s.JungleBridge(**found, scope="league")
        return None

    def bridge(self, champion: str, team: str | None = None) -> s.JungleBridge:
        team_id = self.resolve(team)[0] if team else None
        found = self._bridge(champion, team_id)
        if found is None:
            raise NotFoundError(f"No jungler has played '{champion}'.")
        return found

    def _pool_state(self, state: TeamState) -> s.TeamPoolState:
        return s.TeamPoolState(
            team_id=state.team_id,
            name=self._name(state.team_id),
            roles=[
                s.RolePool(
                    role=r.role,
                    player_id=r.player_id,
                    player_name=self.player_names.get(r.player_id),
                    history=r.history,
                    mass=r.mass,
                    depth=r.depth,
                    status=r.status,
                    remaining=[
                        s.PoolEntry(champion=c, share=share)
                        for c, share in r.remaining[:REMAINING_SHOWN]
                    ],
                )
                for r in state.runways
            ],
            untrusted_roles=state.untrusted,
            ban_suggestions=[
                s.BanSuggestion(role=role, champion=champion, share_of_remaining=share)
                for role, champion, share in state.ban_suggestions
            ],
        )

    def _as_of(self) -> datetime:
        # one second past the last pick, so the whole history counts (plan_series' own default would
        # leave the most recent game out)
        return self.index.now() + timedelta(seconds=1)

    def plan(
        self, team: str, opponent: str, locked: set[str], banned: set[str]
    ) -> s.SeriesPlanResponse:
        (ours_id, _), (theirs_id, _) = self.resolve(team), self.resolve(opponent)
        plan: SeriesPlan = plan_series(
            self.index, ours_id, theirs_id, locked, banned, as_of=self._as_of()
        )
        forecast = None
        if plan.forecast:
            f = plan.forecast
            forecast = [
                s.TeamForecast(
                    team_id=tid,
                    mean_stress=f.mean_stress[tid],
                    p_critical=f.p_critical[tid],
                    weakest_at_end=f.weakest_at_end[tid],
                )
                for tid in (ours_id, theirs_id)
            ]
        jungler = next((r for r in plan.opponent.runways if r.role == "jungle"), None)
        bridges = [
            b
            for champion, _ in (jungler.remaining[:BRIDGE_CHAMPIONS] if jungler else [])
            if (b := self._bridge(champion, theirs_id)) is not None
        ]
        return s.SeriesPlanResponse(
            ours=self._pool_state(plan.team),
            opponent=self._pool_state(plan.opponent),
            forecast=forecast,
            n_sims=plan.forecast.n_sims if plan.forecast else 0,
            jungle_bridges=bridges,
            notes=plan.notes,
        )

    def _context_team(self, team_id: str) -> s.ContextTeam:
        lineup = self.index.current_lineup(team_id)
        if not lineup:
            raise NotFoundError(f"{self._name(team_id)} has no draft history.")
        as_of = self._as_of()
        players = []
        for pick in lineup:
            history = [h for h in self.index.by_player[pick.player_id] if h.t < as_of]
            counts = Counter(h.champion for h in history)
            weights = pool_weights(history, as_of)
            top = sorted(weights.items(), key=lambda kv: -kv[1])[:POOL_SHOWN]
            players.append(
                s.ContextPlayer(
                    player_id=pick.player_id,
                    name=self.player_names.get(pick.player_id, pick.player_id),
                    role=pick.role,
                    history=len(history),
                    pool=[
                        s.ContextPoolEntry(champion=c, share=share, games=counts[c])
                        for c, share in top
                    ],
                )
            )
        name = self._name(team_id)
        return s.ContextTeam(team_id=team_id, name=name, short=_short(name), players=players)

    def _recent_games(self, team_id: str) -> list[s.RecentGame]:
        games = self._rows(
            f"""select d.game_id, any_value(d.started_at), any_value(d.side), any_value(d.won),
                       g.duration_s, g.blue_team_id, g.red_team_id
                from {self._table("draft_enriched")} d join {self._table("games")} g using (game_id)
                where d.team_id = ? group by d.game_id, g.duration_s, g.blue_team_id, g.red_team_id
                order by 2 desc, 1 desc limit {RECENT_GAMES}""",
            [team_id],
        )
        out = []
        for game_id, started, side, won, duration, blue, red in games:
            actions = self._rows(
                f"""select action, champion, role from {self._table("draft_enriched")}
                    where game_id = ? and team_id = ? order by seq""",
                [game_id, team_id],
            )
            out.append(
                s.RecentGame(
                    game_id=game_id,
                    date=_day(started),
                    opponent=self._name(red if blue == team_id else blue),
                    side=side,
                    won=bool(won),
                    duration_s=int(duration),
                    picks=[
                        s.RecentPick(champion=c, role=r if r in ROLE_ORDER else "unknown")
                        for a, c, r in actions
                        if a == "pick"
                    ],
                    bans=[c for a, c, _ in actions if a == "ban"],
                )
            )
        return out

    def series_context(self, team: str, opponent: str) -> s.SeriesContext:
        (ours_id, _), (theirs_id, _) = self.resolve(team), self.resolve(opponent)
        ours, theirs = self._context_team(ours_id), self._context_team(theirs_id)
        jungler = next((p for p in theirs.players if p.role == "jungle"), None)
        bridges = {}
        for entry in jungler.pool if jungler else []:
            if (b := self._bridge(entry.champion, theirs_id)) is not None:
                bridges[entry.champion] = b
        try:
            league = [d.share_top3 for d in self.backtest().pick_depth]
        except NotFoundError:
            league = []
        return s.SeriesContext(
            ours=ours,
            opponent=theirs,
            opponent_recent=self._recent_games(theirs_id),
            jungle_bridges=bridges,
            league_top3_share_by_game=league,
        )

    def backtest(self) -> s.DraftBacktest:
        path = self.cache / "draft_backtest.json"
        if not path.exists():
            raise NotFoundError("draft_backtest.json not found: run `lockout draft-build`.")
        return s.DraftBacktest.model_validate(json.loads(path.read_text(encoding="utf-8")))

    # -- tendencies -----------------------------------------------------------------------------------------

    def draft_tendencies(
        self, team_id: str, scope: Literal["all", "g1", "later"] = "all"
    ) -> s.TeamDraftTendencies:
        if team_id not in self.names:
            raise NotFoundError(f"No team with id '{team_id}'.")
        report: TendencyReport | None = tendency_report(
            self.draft_rows, self.index.picks, team_id, scope
        )
        if report is None:
            raise NotFoundError(
                f"{self._name(team_id)} has fewer than {MIN_TEAM_GAMES} games in scope '{scope}'; "
                "no tendency report."
            )
        return s.TeamDraftTendencies(
            team_id=team_id,
            name=self._name(team_id),
            scope=scope,
            team_games=report.team_games,
            picks=[s.DraftTendencyItem(**asdict(i)) for i in report.picks],
            bans=[s.DraftTendencyItem(**asdict(i)) for i in report.bans],
            ban_targets=[s.BanTarget(**asdict(b)) for b in report.ban_targets],
            fearless_shift=[s.FearlessShiftPoint(**asdict(p)) for p in report.fearless_shift],
            notes=report.notes,
        )
