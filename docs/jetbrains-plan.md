# JetBrains tools: what each one is for in this project

The competition requires the project to be built with JetBrains tools, and the submission needs a short
**Tooling Explanation** of which tool did what. This plan keeps real, well-bounded pieces of work for each tool
so the explanation can be written from what actually happened. Fill the "Outcome" column honestly as work lands.

| Tool | Work reserved for it | Done when | Outcome |
|---|---|---|---|
| **PyCharm** | Project IDE for the Python back end. Interpreter from `.venv`, shared run configurations in `.run/` (pytest, `macrodna etl`, `macrodna draft-build`, `macrodna serve`), debugger and profiler on the ETL. | `.run/*.run.xml` committed; one ETL speed-up found with the profiler and noted | |
| **Junie** (in PyCharm) | The read-only API: `docs/tasks/junie-api.md` (profile, evidence, replay, draft plan, backtest, bridge) with its own tests on a synthetic cache. | `uv run pytest` and `ruff` green; `/openapi.json` lists every endpoint; Junie's feedback written down | |
| **DataGrip** | Explore the Parquet cache with SQL (DuckDB). Save at least five insight queries as `docs/sql/*.sql`, for example ban rate by game number, first lane seen by jungle champion, objective set-up by team. | queries committed and each one explained in a comment; one of them feeds a UI chart | |
| **WebStorm + Junie** | Self-contained front-end components against fixed props: `PoolRunwayCard` (per-role pool bars with status), `DepletionChart` (pool left by game number), `EvidenceDrawer` (the games behind a number). | components render from fixtures, typed against the API models, with tests | |
| **Air** | A parallel agent run on a bounded refactor or test-writing task, reviewed next to the code, for example more edge-case tests for the detectors. | the diff reviewed and merged, with notes on what worked | |

## Ground rules

- JetBrains tools must never see licensed data. `.aiignore` excludes `private/` and data files; keep the
  "do not use my data for training" options enabled. Tests use synthetic fixtures only.
- Commit the IDE evidence: `.idea` (project files only), `.junie`, `.air` and `.run`.
- Write `AI_SHOWCASE.md` from real experience: which task, what the tool got right, what had to be fixed.
  Disclose other AI tools used in the project too (this repository was started with Claude Code); the bonus prize
  is judged on the JetBrains tools, so the story should centre on them.
