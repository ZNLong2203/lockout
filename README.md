# MacroDNA

**Fearless draft preparation for League of Legends, grounded in how teams actually play.**
Entry for the *Cloud9 x JetBrains: Sky's The Limit Hackathon 2026*, Category 2 (LoL): Macro Scouting & Draft Management.

In Fearless Draft every champion picked in a game is locked for the rest of the series, for **both** teams.
A player's comfortable pool shrinks game after game, and by game 3 or 4 some role is playing off its pool.
Coaches track this in spreadsheets. MacroDNA reads the official GRID feeds (745 series, 1,739 games) and answers:

- **Which of their roles runs out of champions first, and what would a ban take away?** Pool state per player, ban targets, and a Monte Carlo forecast of the series.
- **And ours?** The same view for our own lineup: which champions to save for game 3 or 4.
- **What does that pick mean on the map?** A *macro bridge* from a jungle champion to how that jungler opens and where they show up first, from player trajectories.
- **What are their tells?** Evidence-backed conditional behaviours (objective trades, jungle start versus first objective, first gank by lane), compared with the league and corrected for multiple comparisons.

Every number carries its sample size, and the backtest is reported as it came out, including what it does *not* show.
See [docs/methodology.md](docs/methodology.md).

> **Status:** early development. See [docs/roadmap.md](docs/roadmap.md).

## Try the planner

Requires Python 3.12+ with [uv](https://docs.astral.sh/uv/).

```bash
# 1. Clone the hackathon data OUTSIDE this project (it is proprietary, never commit it)
git clone https://github.com/cloud9esports/stl-hackathon-2026-grid-starter.git ../stl-hackathon-2026-grid-starter

# 2. Install, build the local cache, run the detectors and the draft analysis
uv sync
uv run macrodna doctor
uv run macrodna etl
uv run macrodna detect
uv run macrodna draft-build

# 3. Plan a series: our team, the opponent, and the champions already locked
uv run macrodna plan "Cloud9" "100 Thieves" --locked "Ezreal,Rumble,Orianna"
```

The data location is read from `STL_DATA_DIR` (default `../stl-hackathon-2026-grid-starter`). All derived data is
written to `private/cache/`, which is gitignored.

## How the work is split across JetBrains tools

See [docs/jetbrains-plan.md](docs/jetbrains-plan.md) for which tool does what.

## Data license

The GRID data is proprietary, licensed for the hackathon only, and is **not** part of this repository.
This repo contains source code, documentation and aggregate results only.
Match data is provided by GRID. This project is not endorsed by Riot Games or Cloud9.

## License

[MIT](LICENSE), covering the source code only.
