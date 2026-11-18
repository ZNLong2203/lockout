# Project guidelines for Junie

MacroDNA: macro scouting for League of Legends from player trajectories (Python back end, React/TypeScript
front end). Read `AGENTS.md` first: it holds the data-license rules, which are strict.

## Hard rules

- The GRID data is proprietary. **Never read, print, copy, paste or summarise rows of it**, and never open
  files under `private/` or the data repo. Work from code, schemas and tests only.
- Tests use small **synthetic** fixtures built in code. Do not generate fixtures from real data.
- If the IDE offers an option to exclude your inputs from training or retention, keep it enabled.
- Do not stage everything blindly: before committing, run `git diff --cached --name-only` and check it.

## Commands

```bash
uv sync                       # install
uv run pytest                 # tests (must stay green)
uv run ruff check src tests   # lint
uv run ruff format src tests  # format
uv run macrodna etl           # build the local cache (needs the data repo, see README)
uv run macrodna detect        # run the detectors on the cache
```

## Conventions

- Python 3.12+, type hints everywhere, `ruff` clean, tests next to the behaviour they cover in `tests/`.
- Commits follow Conventional Commits (`feat(api): ...`, `fix: ...`, `test: ...`, `docs: ...`).
- Every number shown to a coach carries its sample size `n` and, where relevant, its evidence (game, time).
- The API contract is `docs/api-contract.md` and `src/macrodna/api/schemas.py`. Do not change a field name
  without updating both and telling the front-end owner.
