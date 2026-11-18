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

## Limitations

- Positions arrive every 1-10 s per player, so timings are good to about 5 s, not to the second.
- Team identity follows the feed's team id; roster changes within a team are not separated yet.
- Behaviour is estimated from at most a couple of seasons of pro play. Small samples are flagged, never hidden.
