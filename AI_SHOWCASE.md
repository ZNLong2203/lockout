# Tooling explanation

Lockout was built with **JetBrains Air**, running the Claude agent, inside **PyCharm**. The short case study for
the Best AI-Powered Workflow Story bonus is [docs/ai-workflow-story.md](docs/ai-workflow-story.md).

| Tool | What it did in this project | Evidence |
|---|---|---|
| **JetBrains Air (Claude agent) in PyCharm** | Built the project end to end from written briefs: the ETL and the macro detectors, the Fearless pool model and its backtest, the read-only API, the web app (draft room, team pages, 3D replay), the draft co-pilot and its training and evaluation scripts, the live win model, and the hosted demo with CI | [`docs/tasks/api-brief.md`](docs/tasks/api-brief.md) (one of the briefs); commit history; [`docs/img/air-agent-sessions.jpg`](docs/img/air-agent-sessions.jpg) (Air's agent sessions in PyCharm); [`docs/img/pycharm-project.png`](docs/img/pycharm-project.png) |
| **PyCharm** | The project IDE: `.idea/` is committed, and shared run configurations in `.run/` cover tests, lint, every `lockout` command, the API, the web app, and "API + web" together | `.run/*.run.xml`; [`docs/img/pycharm-run-config.png`](docs/img/pycharm-run-config.png); the "Full stack (API + web live)" configuration in [`docs/img/air-agent-sessions.jpg`](docs/img/air-agent-sessions.jpg) |

## How we worked with the agent

- **Contract first.** [`docs/api-contract.md`](docs/api-contract.md) and the Pydantic models are the single
  source of truth. A test compares the served `/openapi.json` with the contract, and another compares every model
  with its TypeScript interface, so the agent, the API and the front end cannot drift apart.
- **Tests that fail on purpose.** The agent mutated its own code (route prefix, minimum game count, event scope)
  to prove the tests catch each change. A test also caught a deadlock in the win-model endpoint before it shipped.
- **Measure, don't claim.** Every model was compared with a baseline on data it had not seen:
  - the co-pilot: 24.8 % → 32.1 % → 34.8 % → 39.9 % top 3 (72.9 % top 10) against a baseline of about 26 %;
  - the win model: log loss 0.651 → 0.639, 73.6 % right when confident.
  - A cross-check between Python and the browser code caught a label leak in the first tree model (42.8 % that was
    really 37.2 %) before any number was published.
  When a tempting change made things worse on held-out data (a wider meta window, per-player Elo), it was dropped
  and written down. See [docs/methodology.md](docs/methodology.md).
- **Licensed data kept out of view by design.**
  - Synthetic fixtures feed every test, and `.aiignore` hides the data folders.
  - Checks against the real cache print counts only.
  - The public demo runs on public Leaguepedia data (CC BY-SA 3.0), never on the licensed data.
  - The "do not use my data for training" setting was on for the whole project.

## What had to be fixed or decided by hand

- **Direction.** The first plan was macro-only; re-reading the Category 2 judging text ("must demonstrate ...
  draft preparation") turned it draft-first, with macro as supporting context.
- **UI.** The first screens were text-heavy. They were rebuilt around search, real champion art and team logos,
  a 3D Summoner's Rift and a broadcast-style replay, after walking through the app as a newcomer.
- **Dependency.** Starlette's `TestClient` needs an extra package the brief did not allow, so the tests use a small
  in-process ASGI client.
- **A no-op check.** One mutation test did nothing because the formatter had wrapped the line it edited. We now
  check that the edit was really applied.

## What we would tell another team

1. Write the contract and the brief first; the agent, the tests and the front end then share one source of truth.
2. Ask for tests that fail on purpose, and for every model, a baseline and a held-out score.
3. Protect licensed data with structure (fixtures, ignore files, counts-only checks), not with promises.
