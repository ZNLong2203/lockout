# AGENTS.md

Rules for AI coding agents (Claude Code, Junie, JetBrains Air, Codex, …) working on MacroDNA.

## Data license (most important)

The Sky's The Limit 2026 GRID data is proprietary and licensed for the hackathon only.

- **Never commit, upload or mirror data or anything derived from it.** That covers `.zst`, `.jsonl`,
  `.parquet`, `.duckdb`, `.sqlite`, CSV/JSON extracts, caches and copies of `meta/`.
- The data repo lives **outside** this project; code reads it through `STL_DATA_DIR`
  (default `../stl-hackathon-2026-grid-starter`).
- All derived data (parquet cache, DuckDB files, precomputed JSON) goes to `private/cache/`, which is gitignored.
- **Before every commit** run `git diff --cached --name-only` and check the list. Do not use `git add -A` / `git add .`.
- Only code, charts, screenshots and *aggregate* results may be committed. Any public demo excerpt must be
  tiny, clearly labelled, and approved by the project owner first.
- If a tool offers an option to opt out of training/retention on inputs, it must be enabled when it sees the data.

## Project layout

```
src/macrodna/    Python package: ETL, analysis (macro detectors), API
web/             React + TypeScript front-end (2D replay, scouting views)
tests/           pytest
docs/            PUBLIC documentation (methodology, architecture)
private/         GITIGNORED: notes, research, caches, .env
```

## Conventions

- Python 3.13, managed with `uv`. Format/lint with `ruff`. Tests with `pytest`.
- Commits follow **Conventional Commits** (`feat(scope): …`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- Every claim the product shows to a coach must carry **evidence** (series id, game, game-clock time) and a
  **sample size**. Never present a statistic without `n`.
- Keep `AI_SHOWCASE.md` updated when a JetBrains tool (IDE, Junie, Air) materially shaped a piece of work.
