# Architecture

MacroDNA is a local-first pipeline: GRID feeds go in, a private Parquet cache is built, a read-only API serves
aggregates from it, and a static web app shows them. Nothing derived from the licensed data leaves the machine.

```
GRID feeds (.zst, outside the repo)
   │  macrodna etl                 streams each series: positions, events, draft
   ▼
private/cache/lol/*.parquet        gitignored; tracks/ holds 1 Hz positions per series
   │  macrodna detect              roles, jungle opening, objective set-up, tells
   │  macrodna draft-build         enriched draft table, pool backtest, pick depth by game
   ▼
macrodna serve  (FastAPI, 127.0.0.1:8000)     read-only, schemas in src/macrodna/api/schemas.py
   │  /api/...                     JSON, every rate with its n
   ▼
web/ (React + TypeScript, Vite)    proxies /api; runs on synthetic demo data without the API
```

## Back end (`src/macrodna/`)

| Module | Role |
|---|---|
| `etl/` | Streams the compressed feeds into per-series position shards and the `games`, `players`, `events`, `draft` tables |
| `roles.py`, `geometry.py` | Role inference from behaviour; lane paths, camps and pits measured from the data (no Riot map art) |
| `detectors/` | `jungle` (opening route, first lane), `objectives` (players in range before each objective), `tells` (12 fixed hypotheses, exact test, Benjamini-Hochberg) |
| `draft/` | `pools` (Fearless pool maths), `simulate` (Monte Carlo series), `planner` (ban targets, forecast, macro bridge), `tendencies` (pick/ban habits and the Fearless shift) |
| `api/` | `schemas.py` is the contract, `queries.py` reads the cache and maps it onto the schemas, `app.py` declares the routes |
| `cli.py` | `doctor`, `etl`, `detect`, `draft-build`, `plan`, `tendencies`, `serve` |

Design rules that shape the code:

- **Pure functions over rows.** The maths (`pools`, `simulate`, `tendencies`, `tells`) takes plain rows and returns
  dataclasses, so it is tested with synthetic fixtures and reused unchanged by the CLI and the API.
- **The API only reshapes.** `queries.py` selects and joins; it never recomputes a statistic. Tell strength, q-values
  and baselines are read from `tells.parquet`; the planner and the tendency report are called, not re-implemented.
- **Every response has a schema** (`response_model`), so no raw feed content can leave the server, and every rate
  carries its sample size.
- **Honest refusals.** A team with fewer than 6 games gets a `404` with a reason instead of empty numbers.
  The server refuses to start when the cache or the team names are missing, and says which command builds them.

## API

The contract is [api-contract.md](api-contract.md). Highlights:

| Endpoint | Used by |
|---|---|
| `/api/series/context`, `/api/draft/backtest` | Draft room |
| `/api/teams/{id}/draft-tendencies` | Pick/ban tendencies and the Fearless shift chart |
| `/api/teams`, `/api/teams/{id}/profile`, `/api/teams/{id}/tells/{tell}/evidence` | Scouting page and the games behind each tell |
| `/api/games/{id}/replay` | 2D replay (one position per player per second, plus kills, objectives and structures) |
| `/api/draft/plan`, `/api/draft/bridge` | Series plan and the jungle macro bridge |

## Web app (`web/`)

Three hash-routed pages in one static bundle (no server rewrite rules, every view linkable):
`#/draft` (the interactive Fearless draft room, kept mounted so a draft in progress is never lost),
`#/scouting/<team>` (jungle openings, objective set-up, tells with their evidence) and
`#/replay/<game>?t=<seconds>` (2D replay; evidence links open it ten seconds before the trigger).

- The map is our own stylised Summoner's Rift drawn from the measured geometry (`src/lib/map.ts`), shared by the
  jungle map and the replay. Champion portraits come from Riot's Data Dragon at runtime and are never stored.
- `src/api/types.ts` mirrors `schemas.py`; `tests/test_contract.py` fails when the two drift apart.
- Without `VITE_API=live` the app runs on **synthetic** demo data (`src/demo/`), clearly badged as such.

## Testing

| Layer | Tests |
|---|---|
| Maths and detectors | `pytest`: synthetic rows only |
| API | `tests/test_api.py` over a tiny synthetic cache built in a temp folder; each endpoint, the 404 rules, the event filter, round-trip against the schemas, and that the OpenAPI paths equal the contract table |
| Contract | `tests/test_contract.py`: every schema model has a matching TypeScript interface with the same fields and nullability |
| Web logic | `npm test` (Vitest): draft order and Fearless locks, pool thresholds, replay interpolation, routes, map geometry |

## IDE

The project opens in PyCharm with the `.venv` interpreter. Shared run configurations live in `.run/` (tests, lint,
each `macrodna` command, the API, the web app, and a compound "Full stack (API + web live)" that starts both).

## Data licence

The data repo lives outside this project (`STL_DATA_DIR`). All derived data goes to `private/cache/`, which is
gitignored, and `.aiignore` keeps AI tools away from it. Only code, documentation, charts and screenshots of
synthetic demo data are committed. See [../AGENTS.md](../AGENTS.md).
