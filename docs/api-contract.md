# API contract

Read-only HTTP API over the local cache. Models live in
[`src/lockout/api/schemas.py`](../src/lockout/api/schemas.py) and are the source of truth.
Base path `/api`. Errors use standard HTTP codes with a JSON `{"detail": "..."}` body.

| Method and path | Returns | Notes |
|---|---|---|
| `GET /api/health` | `{"status": "ok", "games": int}` | `games` is read from the cache |
| `GET /api/logos` | `TeamLogos` | `{logos: {team name: url}, source}` from the `team_logos.json` URL cache written by `lockout logos` (Leaguepedia). Empty until that has run; no image is stored |
| `GET /api/teams?q=&event=` | `TeamSummary[]` | `q` is a case-insensitive name filter, `event` an exact event name |
| `GET /api/teams/{team_id}/profile?event=` | `TeamProfile` | `event` restricts every aggregate to one split/league |
| `GET /api/teams/{team_id}/tells/{template_id}/evidence` | `EvidenceItem[]` | One item per occurrence, newest first |
| `GET /api/teams/{team_id}/draft-tendencies?scope=` | `TeamDraftTendencies` | `scope` is `all` (default), `g1` or `later`. Rates versus the league plus the Fearless shift by game; logic is `lockout.draft.tendencies.tendency_report`. 404 below 6 games in scope |
| `GET /api/games/{game_id}/replay` | `Replay` | One position per second per player; events are `kill`, `objective`, `structure`, `spawn`, `respawn` only. 404 when no positions are stored |
| `GET /api/draft/plan?team=&opponent=&locked=&banned=` | `SeriesPlanResponse` | `team` and `opponent` are a team id or part of a name (see below); `locked` and `banned` are comma-separated champion names; the logic is `lockout.draft.planner.plan_series`. `jungle_bridges` covers the opponent jungler's five best remaining champions |
| `GET /api/series/context?team=&opponent=` | `SeriesContext` | Powers the draft room. Lineups from `PickIndex.current_lineup`, pools from `pool_weights` (top 8 champions per player), opponent's last 5 games from `draft_enriched`, `jungle_bridge` for each champion in the opponent jungler's pool, `league_top3_share_by_game` from `draft_backtest.json` |
| `GET /api/champions?before=` | `ChampionStats[]` | League pick/ban/presence/win rate and role split per champion over the 90 days before `before` (default: the newest game), by presence. `win_rate` is null below 5 picks; `games` is the denominator |
| `GET /api/series?team=&opponent=&limit=` | `SeriesSummary[]` | Finished two-team series, newest first. With `team`, that team is listed first. `format` is inferred from the winning score |
| `GET /api/series/{series_id}/draft?ours=` | `SeriesDraft` | Each game's 20 draft steps in tournament order, plus a `SeriesContext` built from data **before** game 1 (lineups from game 1, pools and recent games as of its start) so a replay cannot peek ahead; `meta` is the league meta of the 90 days before game 1 |
| `GET /api/draft/win-model?team=&opponent=&before=` | `WinModel` | Coefficients of a logistic model of P(blue wins) from the draft state, fitted on games before `before` (default: all), the two teams' Elo at that time and a time-split evaluation against Elo alone. Logic: `lockout.draft.winmodel` |
| `GET /api/draft/backtest` | `DraftBacktest` | Read `draft_backtest.json` from the cache; do not recompute |
| `GET /api/draft/bridge?champion=&team=` | `JungleBridge` | `scope` is `team` when that team has the champion, else `league`; 404 if never played |

## Naming a team

`team` and `opponent` take a team id or part of a team name, case-insensitive (`PickIndex.find_team`). Only teams
with draft history match; when several do, the most recently active wins. No match is a `404`, an empty value a `422`.

## Rules the implementation must follow

1. **Never return raw feed content** (event payloads, series state). Only the fields in `schemas.py`.
2. **Always return `n`** with every rate. Never round a rate without its sample size.
3. A `TeamProfile` (and `TeamDraftTendencies`) for a team with fewer than 6 games returns `404` with a clear message, not empty numbers.
   With `event`, the 6 games are counted inside that event. The event filter applies to the games count, the
   jungle profile and the objective figures; tells are computed once over all games and stay unfiltered (a note says so).
4. Tell `strength` comes straight from the cache (`tells.parquet`); do not recompute statistics in the API.
5. League baselines come from the cache; objectives' `league_mean_players_m30` is the mean over all teams
   (inside the event when `event` is given). Jungle routes are grouped by their first three camps.
6. The API reads the cache from `LOCKOUT_CACHE_DIR` (default `private/cache/lol`) and team/champion names from
   `STL_DATA_DIR/meta`. It must start with a clear error if either is missing.

## Cache tables (Parquet, under `private/cache/lol/`)

`games`, `players`, `roles`, `events`, `draft`, `draft_enriched`, `jungle`, `objectives`, `tells`,
`tell_evidence`, `tracks/*.parquet`, and `draft_backtest.json`. Column lists are in `src/lockout/etl/build.py`, `detectors/jungle.py`,
`detectors/objectives.py` and `detectors/tells.py`.
