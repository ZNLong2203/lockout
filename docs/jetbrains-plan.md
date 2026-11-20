# JetBrains tools: what each one is for in this project

**Requirement (official rules and the JetBrains announcement):** the project must use *at least one* eligible
JetBrains tool: a JetBrains IDE (PyCharm, WebStorm, DataGrip, ...), JetBrains Air, or Junie. Using more than one is
allowed, not required. The submission needs a short **Tooling Explanation** of which tool did what, and the
Technological Implementation score looks at how thoroughly and skilfully the tools were used.

So the plan below has a **minimum** that satisfies the rules and **optional** extras that add depth. Fill the
"Outcome" column honestly as work lands; the Tooling Explanation is written from it.

## Minimum (do these)

| Tool | Work | Done when | Outcome |
|---|---|---|---|
| **PyCharm** | The project IDE for the Python back end: interpreter from `.venv`, shared run configurations in `.run/` (pytest, `macrodna etl`, `macrodna draft-build`, `macrodna serve`). | `.run/*.run.xml` and `.idea` committed | |
| **Junie** or **Air** (in PyCharm) | The read-only API, `docs/tasks/junie-api.md`. Air can run **Claude Agent**, Junie, Codex, Gemini, Cursor or Copilot as the agent, so either route counts as JetBrains tooling. | `uv run pytest` and `ruff` green; `/openapi.json` lists every endpoint; what the agent got right and wrong is written down | |

## Optional (add depth, in this order)

| Tool | Work | Done when | Outcome |
|---|---|---|---|
| **DataGrip** | Explore the Parquet cache with SQL (DuckDB). Save at least five insight queries as `docs/sql/*.sql` (ban rate by game number, first lane by jungle champion, ...). | queries committed, each explained | |
| **WebStorm + Junie/Air** | Self-contained components against fixed props: `PoolRunwayCard`, `DepletionChart`, `EvidenceDrawer`. | components render from fixtures, typed against the API models | |
| **Air** (second use) | A parallel agent on a bounded task, reviewed beside the code, e.g. edge-case tests for the detectors. | diff reviewed and merged, with notes | |

## Practical notes

- Every participant gets promo codes for **two months of All Products Pack and AI Ultimate**. Junie Lite is free
  at least until 31 Dec 2026 and does not use AI credits, which is enough for small edits and test writing.
- JetBrains runs **office hours and a live Air demo on 9 Dec 2026, 10:00 PT**.
- JetBrains tools must never see licensed data. `.aiignore` excludes `private/` and data files; keep the
  "do not use my data for training" options enabled. Tests use synthetic fixtures only.
- Commit the IDE evidence: `.idea` (project files only), `.junie`, `.air` and `.run`.
- Write `AI_SHOWCASE.md` from real experience: which task, what the tool got right, what had to be fixed.
  Disclose the other AI tools used in the project too (this repository was started with Claude Code); the bonus
  prize is judged on the JetBrains tools, so the story should centre on them.
