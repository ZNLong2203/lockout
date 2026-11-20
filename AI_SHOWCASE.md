# AI showcase

How AI tools shaped Lockout, written from what actually happened. The bonus prize looks at the JetBrains tools,
so they come first; the other AI tools used in the project are disclosed after them.

> Draft: the items marked **[owner]** need the project owner's own notes, screenshots or timings. Nothing here
> should be submitted before they are filled in or removed.

## JetBrains

| Tool | What it was used for | Evidence |
|---|---|---|
| **JetBrains Air in PyCharm (Claude agent)** | An Air agent session in PyCharm, running the Claude agent (Opus 5.5). In that session it wrote the read-only HTTP API (`src/lockout/api/{app,queries}.py`, `lockout serve`, `tests/test_api.py`) from the written brief `docs/tasks/junie-api.md`, then the scouting page, the 2D replay and the draft-tendency panel in `web/` | [`docs/img/pycharm-project.png`](docs/img/pycharm-project.png) and [`docs/img/pycharm-run-config.png`](docs/img/pycharm-run-config.png) (the IDE with the project and the shared run configuration loaded); **[owner]** add a screenshot of the task and of the diff review |
| **PyCharm** | The project IDE for the Python back end (`.idea/` is committed). Shared run configurations in `.run/` (tests, lint, each `lockout` command, the API, the web app, and one that starts API and web together) | `.run/*.run.xml` in the repo, written by the agent as files and run from the IDE by the owner; **[owner]** add a screenshot of a run and of a debugger session |
| **Junie / DataGrip / WebStorm** | **[owner]** only list what was actually used, or delete this row | |

### What the agent got right

- It worked from a **written contract** (`docs/api-contract.md` plus the Pydantic models in `schemas.py`) and
  produced all ten endpoints with a response model each, so nothing outside the schemas can leave the server.
- Tests were written against a **synthetic cache built in a temp folder**; they pin the 404 rule, the event filter and
  the round-trip against the schemas. Three deliberate mutations of the implementation (the route-prefix length, the
  minimum game count, the event scope) each made the suite fail, so the tests are not decoration.
- A test compares the endpoints in `/openapi.json` with the table in the contract, and another compares every
  Pydantic model with the TypeScript interface of the same name, so documentation and front end cannot drift silently.
- It smoke-tested every endpoint on the real cache printing only status codes and sizes, never values.

### What had to be fixed or decided by hand

- **Scope.** The first plan reserved the API for "the IDE agent" and left only the web app to Claude Code. That split
  was wrong: the same agent was already running inside PyCharm, so it built the API too.
- **Dependency.** Starlette's `TestClient` needs the extra package `httpx2`. The brief said to add no dependencies,
  so the tests use a small in-process ASGI client instead. Installing the package was also blocked by the
  environment's permission rules, which is why the choice was made and not revisited.
- **A no-op check.** The first mutation test did nothing: `ruff format` had wrapped the constant it tried to edit, so
  the pattern did not match and the run "passed". It was caught by checking that the edit had really been applied.
- **Data licence.** One aggregate-only CLI run printed team-level rates (not rows) into the agent's context, which
  the project rules say to avoid. It was reported at once; every later check against the real cache printed status
  codes and counts only.
  **[owner]** confirm the "do not use my data for training" options were on in the JetBrains AI settings at the time and attach a screenshot.

## Other AI tools (disclosure)

- **Claude Code (terminal)** started the repository and wrote most of the analysis: ETL, role and map geometry,
  jungle and objective detectors, tells, the Fearless pool model, its backtest and the first versions of the web app.
  Commits made with it carry a `Co-Authored-By` trailer.
- **Claude** did the competition research and the design of the draft-first
  direction after the Category 2 judging criteria were re-read.

## What we would tell another team

1. Write the contract first and test against it; both the agent and the front end then work from the same source.
2. Ask the agent for tests that fail when the behaviour breaks, and check that they do.
3. Keep licensed data out of the agent's view by design (`.aiignore`, synthetic fixtures), not by promise.
