# How AI built Lockout's backbone: a case study

*Bonus entry, Best AI-Powered Workflow Story. Main entry: Lockout, Category 2 (LoL).*

## The problem

Lockout turns 1,739 professional games of GRID data into Fearless draft preparation. The analysis was done; the
missing piece was the backbone between the analysis and the coach. That backbone is a read-only API and the first
screens on top of it, all built on licensed data that must never leave the machine. Building it by hand would have
taken the time we wanted for the draft features.

## The workflow

We worked in **PyCharm** with **JetBrains Air** running the Claude agent, from a written brief.

1. **Contract first.** We wrote [`docs/api-contract.md`](api-contract.md) and the brief
   [`docs/tasks/junie-api.md`](tasks/junie-api.md): ten endpoints, their response models, the error rules, and
   the data-licence rules.
2. **Air built the backbone in one session.** Inside PyCharm, the agent wrote the FastAPI app
   (`src/lockout/api/`, `lockout serve`). It then built the scouting page with evidence, the 2D replay, and the
   draft-tendency panel in `web/`.
3. **The IDE kept it runnable.** Shared run configurations in [`.run/`](../.run) cover tests, lint, each CLI
   command, the API, the web app, and "API + web" together. A judge, or a teammate, starts the whole stack from
   PyCharm in one click.

## Three challenges AI helped solve

**1. Tests that really test.** We asked for tests that fail when behaviour breaks, and checked that they do.
The agent mutated its own implementation three times (route prefix, minimum game count, event scope), and each
mutation made the suite fail. The first mutation run did nothing, because the formatter had wrapped the edited
line. We caught it by verifying that the edit had really been applied, which is now a habit.

**2. Docs and front end that cannot drift.**
- One test compares the served `/openapi.json` with the contract table.
- Another compares every Pydantic model with the TypeScript interface of the same name.
- When later work added four endpoints, these tests failed until the docs and types matched.

**3. Licensed data kept out of the agent's view by design.**
- A synthetic cache feeds every test.
- `.aiignore` hides the data folders.
- Every check against the real cache printed status codes and counts only.
- One early aggregate output reached the agent's context. It was reported at once and the rule was tightened.

## Results

- 10 API endpoints with typed response models (14 today); 28 API tests and 40 contract tests from the first session.
- The scouting page, 2D replay and tendency panel the later draft room builds on.
- Run configurations that make the project one click to run in PyCharm.
- **[owner]** Time taken compared with your own estimate by hand.

## What we would tell another team

1. Write the contract and the brief first. The agent, the tests and the front end then share one source of truth.
2. Ask for tests that fail on purpose, and check that the failure is real.
3. Protect licensed data with structure (synthetic fixtures, ignore files, counts-only checks), not with promises.

## Disclosure

Other AI tools were used too. **Claude Code** wrote most of the analysis and the later draft features: the
co-pilot, the Fearless budget and the real-series replay. **Claude** helped with research. Commits made with AI
carry a `Co-Authored-By` trailer. Details are in [AI_SHOWCASE.md](../AI_SHOWCASE.md).
