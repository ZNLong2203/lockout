# From GRID feeds to a draft co-pilot with JetBrains Air: a case study

*Bonus entry, Best AI-Powered Workflow Story. Main entry: Lockout, Category 2 (LoL).*

## The problem

Cloud9's coaches prepare Fearless drafts from spreadsheets. We wanted a tool that reads 1,739 professional games
of GRID data and answers, at every step of a draft, what to ban or pick and why. It had to stay honest (every number
with its sample) and keep licensed data on the machine. A solo builder could not do that by hand in the time we had.

## The workflow

All of it was built with **JetBrains Air**, running the Claude agent, inside **PyCharm**.

1. **Brief, then build.** Each piece started as a written brief with the rules that matter: data licence, contract,
   tests. Example: [`docs/tasks/api-brief.md`](tasks/api-brief.md). Air then built it, from the ETL over the raw feeds
   to the FastAPI service, the React app with its 3D Summoner's Rift, and the draft room.
2. **Run it like a user.** After each feature, the agent ran the app in the browser, took screenshots, walked
   through it as a newcomer and fixed what was confusing. Two examples: walls of text, and a 3D jungle that looked
   like "high-rise buildings" until it was rebuilt from Riot's minimap.
3. **Measure everything.** Every model got a baseline, a held-out set and a script that reproduces its number.
4. **Ship from the IDE.** Shared run configurations in [`.run/`](../.run) start the whole stack in one click.
   GitHub Actions runs the tests and deploys the public demo.

## Four challenges AI helped solve

**1. A recommendation engine that really predicts.**
- The first co-pilot used players' comfort pools and scored 24.8 %: no better than "the three most popular
  champions" (23.6 %).
- Measuring on real series showed why: under Fearless, pools run out, so the league's role meta matters more.
- Air rebuilt it as a blend (32.1 %), then as a learned softmax ranker (34.1 %).
- Then it added the signal coaches know well: Fearless locks picks but not bans, so teams ban the same threats
  again. That took bans to about 40 % and the whole co-pilot to 34.8 % on the 80 most recent series.
- Finally a LightGBM LambdaRank re-ranker: **39.9 % top 3 and 72.9 % top 10**, against a 25.6 % top-3 baseline.
  Its first version claimed 42.8 %. Replaying it in the browser code gave 37.2 %, which exposed a label leak in
  the export. It was fixed before any number was published, and now both agree exactly.
- Each suggestion's reason comes from the features that drove its score.

**2. No peeking at the future.**
- Replaying a real series only means something if the tool knows nothing about it. The agent added a `before`
  time to every context the API builds: lineups, pools, recent games and league meta.
- It used the same rule to choose the win model's settings on a validation slice before a single test run.
  This rule also caught a tempting change (per-player Elo) that helped on the test set but not on validation; it
  was dropped.

**3. Tests that guard the contract.**
- One test compares the served OpenAPI paths with the contract.
- Another compares every Pydantic model with its TypeScript interface.
- When four endpoints were added later, the build failed until the docs and types matched.
- A test caught a deadlock in the win-model endpoint before it ever ran on real data.

**4. Licensed data kept out of view by design.**
- Synthetic fixtures feed every test, and `.aiignore` hides the data folders.
- Checks against the real cache print counts only.
- The public demo runs on invented teams.

## Results

- A Fearless draft room with:
  - a step-by-step co-pilot (39.9 % top 3, 72.9 % top 10 on the most recent series, held out);
  - a live win chance (73.6 % right when confident, 66.7 % overall, on the latest 430 games);
  - a Fearless budget forecast;
  - a composition check;
  - a replay of real series.
- 15 typed API endpoints and a test suite on synthetic data, all green in CI.
- A public demo anyone can open: https://znlong2203.github.io/lockout/
- **[owner]** Time taken compared with your own estimate by hand.

## What we would tell another team

1. Brief the agent like a teammate: rules, contract and the definition of done.
2. Make it use the product as a newcomer, not only pass tests.
3. Never accept a model without a baseline and a held-out score, and keep the negative results.
