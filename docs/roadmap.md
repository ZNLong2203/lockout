# Roadmap

Submission deadline: **12 Jan 2027, 11:00 PT** (13 Jan 02:00 GMT+7).

Category 2 judges look for **draft preparation** support; macro context (jungle pathing, objective set-ups) is
supporting evidence. The product is therefore draft-first with macro as context.

| Phase | Status | Goal |
|---|---|---|
| 0. Foundations | done | Repo, ETL, roles, map geometry, data audit |
| 1. Macro context | done | Jungle opening, objective set-up, evidence-backed tells |
| 2. Draft core | done | Fearless pool stress, backtest, series simulator, planner, macro bridge |
| 3. API | done | Read-only HTTP API (`lockout serve`), 10 endpoints, tested on a synthetic cache; see `docs/api-contract.md` |
| 4. Web app | done | Draft room, scouting profile with the games behind each tell, 2D replay, live mode against the API |
| 5. Pick/ban tendencies | done | `lockout tendencies`, `/api/teams/{id}/draft-tendencies`, panel and Fearless-shift chart in the draft room |
| 6. Polish | in progress | Demo video, submission text, tooling explanation, AI showcase (drafts in `private/submission/`) |

What is left is mostly the owner's: JetBrains tool evidence (see `docs/jetbrains-plan.md`), the demo video and the
Devpost submission.

Cut line if time runs short: ship planner + backtest + macro bridge + replay; drop style twins first.
