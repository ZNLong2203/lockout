# Data audit: what the GRID LoL feeds can and cannot tell us

All figures are aggregates over the 745 series / 1,739 games of the hackathon corpus (LCK, LEC, LTA, LCS,
2025-2026). No match data is included in this repository.

## What is in the feed

Every event carries a full `seriesState` snapshot, including the **position of all ten players** and the
game clock. We derive per game: a positions table, kills, objectives (including NPC spawn events), structures,
turret plates, level-ups, item purchases and the ordered draft.

## Findings that shaped the design

| # | Finding | Consequence |
|---|---|---|
| 1 | Positions are **not** a clean 1 Hz stream. The gap between two position changes of the same player is 1 s in 31 % of cases, 2 s in 21 %, 3 s in 14 %, with a tail past 10 s. | Every position carries an `age` (seconds since the last real sample). Detectors discard or down-weight stale points, and never claim sub-5 s precision. |
| 2 | The order of players in the feed is **not** a reliable role order (a top > mid > bot ordering held in only 28 % of team-games). | Roles are inferred from behaviour (see below). |
| 3 | A few feeds report an absurd game `duration` (one reports ~16 million seconds). | The game clock is the source of truth; durations are clamped to 2 h. Found when it corrupted a table. |
| 4 | Some purchase events omit the item name although the item id is known. | Names are back-filled from other events with the same id. |
| 5 | There are **no jungle-camp clear events** and **no ward placements**. Only grubs, scuttlers, Herald, drakes, Baron and Atakhan are reported. | Jungle routes are inferred from trajectories, not read from the feed. Vision-based claims are out of scope. |
| 6 | Map geometry can be measured from the feed itself. | Lane paths and objective pits are estimated from where players stood when destroying structures / killing objectives, so no Riot map art is needed. |

## Role inference

| Role | Signal |
|---|---|
| Support | bought the support quest item in the opening purchases |
| Jungle | farthest from every lane between 1:45 and 3:15 |
| Top / Mid / ADC | remaining three, ordered by `y - x` while laning (2:00-6:00) |

Validation (independent of the signals above):

- 99.2 % of team-games (3,435 / 3,462) have a unique support-item buyer, so are marked high confidence.
- Median distance between the inferred ADC and support during laning: **663 units**; 86 % of team-games are under 2,500.
- Median `y - x` per role during laning: top **+9,860**, mid **-6**, jungle -516, support -9,439, ADC -9,599.

Known limitation: lane swaps and unusual early rotations can mislabel top/mid/ADC in a small share of games.
