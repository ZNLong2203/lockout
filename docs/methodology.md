# Methodology

Lockout reads the official GRID League of Legends feeds (745 series, 1,739 games: LCK, LEC, LTA, LCS) and
produces opponent scouting that a coach can check. Every claim carries **evidence** (game and game-clock
time) and a **sample size**. See [data-audit.md](data-audit.md) for what the feed does and does not contain.

```
GRID feed (.zst)  ->  ETL  ->  tracks / events / draft   (local cache, never committed)
                              |
                roles + map geometry (inferred from the data)
                              |
        detectors:  jungle opening  |  objective setup  ->  game facts  ->  tells
```

## 1. Roles and map geometry

Roles are inferred from behaviour (support item, distance from lanes, lane position), validated by
independent checks (see the audit). Lane paths and objective pits are measured from where players stood when
they destroyed structures and killed objectives, so the analysis needs no map art. The 3D view builds its terrain at runtime from Riot's official minimap (Data Dragon); nothing derived from it is stored.

## 2. Jungle opening fingerprint

For each jungler, using only real position samples (not held ones):

- **Route**: order of first detected contact with the six camps, in the blue-side frame (red side mirrored).
  Tuned on all junglers: 86 % have at least five camps detected, and 92 % of consecutive steps are between
  neighbouring camps (a random order would be far lower).
- **First lane appearance**: first time the jungler is on a lane path at or past the team's outer tower.

The feed has no camp-clear events, so a route means "first detected contact", not "cleared". The number of
camps detected is kept as the confidence signal.

## 3. Objective setup radar

For each dragon, Baron, Herald and grub wave, and for **both** teams: living players within 2,500 units of the
objective at 60/30/15/5 s before it dies, players inside the pit, seconds of sustained set-up (at least three
players), and presence when it spawned. Dead players keep their death position in the feed, so a living mask is
built from kills and respawns.

Sanity check on the corpus: the team that takes Baron has 3.9 players in the area 5 s before, against 1.1 for
the other team; 91 % of Baron takers have at least three.

## 4. Tells (and why there are few of them)

A *tell* is "when situation S, the team does R in k of n cases", compared with the rest of the league.

- **Fixed library of 12 hypotheses** that a coach would act on (objective trades, conversion after Baron,
  jungle start versus first objective, first gank by lane, pre-positioning). Nothing is mined freely, which
  avoids presenting lucky patterns.
- **Exact binomial test** of each team's rate against the league rate, **Benjamini-Hochberg** correction over
  all team x template tests, and a **shrunk rate** that pulls small samples toward the league.
- A pair is only reported with at least 6 occurrences; "strong" needs 8 occurrences and q <= 0.05.

Result on the corpus: of 455 scored pairs, 5 pass the correction (1.1 %). The raw share with p < 0.05 is 9 %
(5 % expected by chance), so there is a real but modest signal. We would rather show an honest profile with
confidence intervals than invent certainty.

## 5. Fearless draft: pool stress

All 569 multi-game series in the corpus are Fearless: no champion is picked twice within a series. A picked
champion is locked for **both** teams, so a player's comfortable pool shrinks game after game.

- A player's **pool** is the champions they have played, weighted by recency (half-life 120 days). Pools need at
  least 8 prior picks to be trusted; players with less history are shown as "not enough history", never guessed.
- **Remaining mass** is the share of that pool still available after the locked champions and the bans.
  **Stress** of a lineup is the lowest remaining mass among its players: the first role to run out.
- **Series forecast**: a Monte Carlo of both teams picking from their pools under the lock rule gives the
  probability that each role is critical (less than 35 % left) at game 2, 3 or 4.
- **Ban targets**: for the most fragile roles, the champions whose removal takes the largest bite out of what the
  player still has.
- **Macro bridge**: for a jungle champion, how that jungler opens and where they appear first, from the jungle
  detector (team level when the team has played it, league level otherwise, always with `n`).

What the backtest says (no look-ahead; reproduce with `lockout draft-build`):

| Claim | Result | Reading |
|---|---|---|
| Pools really deplete | weakest role's pool left: 65 % (game 2), 44 %, 31 %, 20 % (game 5) | solid |
| The simulator is realistic | game 2: simulated 0.687 vs real 0.658; game 3: 0.476 vs 0.451 | close; slightly optimistic because bans are not modelled |
| Depletion predicts winning across games | critical pools win 47 % (n = 268, CI 41-53 %) vs about 51 % | **not demonstrated** |
| Within the same game, the more comfortable lineup wins | 54.2 % (n = 863, CI 51-58 %, p = 0.014) | modest effect; one of several comparisons looked at, so suggestive only |

### Fearless shift and pick/ban tendencies

- **Pick depth by game** (league-wide, trusted pools only): the rank of each pick in the player's full pool
  (1 = most played) rises from 4.8 in game 1 to 5.6, 6.6, 7.7 and 9.1 in game 5; picks from a player's top 3 fall from
  40 % to 11 %; picks of a champion the player had never played rise from 14 % to 32 %. (Rank is taken in the *full*
  pool: ranking only what is still available would shrink the list and hide the effect.)
- **Team tendencies**: each champion's ban/pick rate for a team is tested against the league rate in the same
  scope (all games, first games, later games) with an exact binomial test and Benjamini-Hochberg correction, and
  every occurrence is kept as evidence. Ban *targets* are read through the role a champion is usually picked in.

We present pool stress as a planning aid for choosing what to ban and what to save, not as a win-rate predictor.

### Draft co-pilot (step by step)

At each of the 20 steps the draft room shows three moves: the best ones for us on our turn, the likeliest ones for
the opponent on theirs. Every card says why in one line and shows the sample it rests on.

**Model.** Every champion still available is a candidate with 16 features:
- its share of an open player's remaining comfort pool, and that player's games on it;
- its share of the league's recent picks in an open player's role;
- which role the team usually takes at this pick slot (league role order), combined with the meta and the pools;
- league ban and pick rates, and the shrunk league win rate;
- both teams' last games (picked it, banned it);
- **bans earlier in this series**: Fearless locks picks but not bans, and teams ban the same threats again;
- the other team's comfort it would take (deny), how thin the relevant pool already is, and flex.

A softmax (conditional logit) over the candidates ranks them, with one weight vector per step type (our bans,
our picks, their bans, their picks). `npm run train:copilot` learns the weights on 488 series (Jan 2025-Apr 2026;
older series weigh less, half-life 180 days). The result is 64 numbers in `web/src/lib/copilot.ts`. The reason on
each card is built from the features that contributed most to its score, so the explanation matches the ranking.

**No look-ahead.** The real-series replay and the evaluation use a context the API builds from data *before*
game 1 of the series: lineups from game 1, pools as of its start, both teams' earlier games, league meta and role
order before it.

**Tree re-ranker (live mode).** A LightGBM LambdaRank model re-ranks the linear model's top 60 candidates. It
uses the same features plus the step, the game number, whether the champion's main role is still open on each
side, what the players have actually played in the last 30 days (any champion, not only their top 8) and the
21-day meta trend. Trees capture interactions the linear model cannot: the same signal means something else at
the first ban of game 1 and at the fourth ban of game 3.
- Steps: `npm run export:features`, then `lockout copilot-train` (needs `uv sync --group ml`).
- Split by series and time: the 80 most recent series are the test set; the next 80 are for early stopping and
  for choosing settings; every older series is for training.
- The fitted model is derived from licensed data. It stays in the gitignored cache and is served only by the local
  API, so the public demo uses the linear model.
- `npm run eval:copilot` scores both models in the browser code. It gives the same numbers as Python, which checks
  that the tree export is right.

**How often is the real choice in the co-pilot's list?** Held out: the 80 most recent series (Apr-Oct 2026),
4,500 steps, never used for training or for any choice. Reproduce with `cd web && npm run eval:copilot`.

| Real choice within… | Top 1 | Top 3 | Top 5 | Top 10 |
|---|---|---|---|---|
| **Linear + LightGBM re-ranker (live mode)** | **17.1 %** | **39.9 %** | **54.3 %** | **72.9 %** |
| Linear softmax, 16 features (public demo) | 15.1 % | 34.9 % | 46.9 % | 63.9 % |
| Baseline: available champions by league presence | - | 25.6 % | - | - |
| Chance (about 170 champions) | 0.6 % | 2 % | 3 % | 6 % |

In the top 3, bans reach 44.6 % and picks 34.8-35.5 %. The draft room shows the top 3 as cards and ranks 4-10 as
a shortlist.

**A leak we caught.** The first tree model scored 42.8 % top 3 in Python but only 37.2 % when the browser code
replayed it. The export had added the real choice to the candidates whenever the linear model had missed it, so a
rank of 40 or more gave the answer away. The fix: candidates are the linear top 60 and nothing else. With that fix,
Python and the browser agree exactly.

Earlier versions were checked on an older split (58 series, Jan-Apr 2026) and give the path:
- pool only: 24.8 % (tuning set);
- hand-tuned blend of pool and role meta: 32.1 %;
- first learned ranker, 11 features: 34.1 %.

What we learned along the way:
- The league's role meta predicts picks better than a player's own pool. Under Fearless, pools run out and new
  champions appear (section above).
- A recent 90-day meta window beat windows stretched to at least 100 or 300 games (30.5 % and 28.2 % held out
  with the first model), because the extra games come from older patches.
- Ban habits within a series are the strongest new signal: bans went from 35 % to about 40 %.
- More training data alone did not help the linear model (32.4 % with 488 series against 32.6 % for weights
  learned on far fewer); the right features did, and then trees.
- Picks stay harder than bans: under Fearless a team often picks a champion its player has rarely played.

This is a *prediction* metric. Our own recommendations are not meant to copy what teams did, so the same score is
only a sanity check for them. Engage and the early/late power curve in the composition check come from a short
editorial list; damage split, frontline and range come from Riot's Data Dragon classification.

### Live draft win chance

The draft room shows our chance to win, updated after every pick, and how each suggested pick would move it.
It is a logistic regression (`src/lockout/draft/winmodel.py`, `lockout winmodel`) on four features, blue minus
red, each defined for a partial draft:
- team Elo (K = 32, pulled halfway back to 1500 after a break of more than 30 days);
- pool comfort of the picks so far;
- shrunk league win rate of the picks so far (last 90 days);
- the comfort pool left at the start of the game (Fearless).
All of them use earlier games only. The settings were chosen on a validation slice (games at 60-75 % of the
timeline), then scored once on the latest 25 %:

| Latest 430 games (trained on the 1,288 before) | Accuracy | Log loss | AUC |
|---|---|---|---|
| **Elo + draft (current)** | 66.7 % | **0.639** | **0.688** |
| Elo alone (same settings) | 67.7 % | 0.641 | 0.681 |
| First version (K = 24, no off-season pull) | 66.7 % | 0.651 | 0.679 |
| Always blue | 51.8 % | 0.690 | - |

**When the model is confident.** It gave one side 65 % or more in 174 of the 430 test games and was right in
73.6 % of them (70.7 % over the 256 games at 60 % or more). It is well calibrated up to 80 %: when it said about
75 %, the actual rate was 75.9 % (n = 87). Above 80 % it was over-confident (65.4 %, n = 26). The win bar shows a
"confident" badge from 65 %.

Team strength sets the starting point and the draft moves it by a few points: draft features improve calibration
and ranking (log loss, AUC) but not accuracy, which is close to what pre-game predictions of pro games usually
reach. Tried and not kept, because each failed to beat this model on the validation slice by more than noise:
- per-player Elo, to follow roster changes (it helped on the test set but not on validation);
- gradient boosting (scikit-learn): validation log loss 0.67-0.69 against 0.66, too little data for trees;
- four more features (player proficiency on the champion, team form, series momentum, game number):
  test log loss 0.637 against 0.639, accuracy unchanged.

Pre-game predictions of professional games rarely go much past this level.
A replay uses a model fitted only on games before the series. The bar is labelled "model" and its tooltip carries
these numbers.

### Fearless budget

The draft room re-runs the series Monte Carlo in the browser from the series as entered. It uses the same model as
above, with each player's top 8 champions as their pool. The resulting table shows each player's comfort left at
the start of every game: exact for games already played, forecast with the risk of being critical for later games.
Hovering a champion re-runs the forecast as if it were picked now. Changes under 3 points are within simulation
noise and are hidden.

## 6. Replay and evidence

Every tell keeps each occurrence (game, trigger time, whether the team did what the tell says). The API serves those
occurrences newest first, and the web app opens the 2D replay ten seconds before the trigger. The replay draws the
positions of all ten players once per second on our own map; a position that was never sampled is shown as unknown
(`-1, -1` in the API), never invented, and the key events listed next to the map are only kills, objectives and
structures from the feed. Unknown players are simply not drawn at that second.

Two choices keep the profile page honest: jungle routes are grouped by their **first three camps** (complete routes
are almost all unique, so they would give every route a sample size of one), and the **event filter** restricts the
games count, the jungle profile and the objective figures but not the tells, which are tested once over all games
(re-running the tests per event would change the multiple-comparison correction). A note on the page says so.

## Limitations

- Positions arrive every 1-10 s per player, so timings are good to about 5 s, not to the second.
- Team identity follows the feed's team id; roster changes within a team are not separated yet.
- Behaviour is estimated from at most a couple of seasons of pro play. Small samples are flagged, never hidden.
