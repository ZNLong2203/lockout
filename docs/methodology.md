# Methodology

MacroDNA reads the official GRID League of Legends feeds (745 series, 1,739 games: LCK, LEC, LTA, LCS) and
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
they destroyed structures and killed objectives, so no Riot map art is used.

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

What the backtest says (no look-ahead; reproduce with `macrodna draft-build`):

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
