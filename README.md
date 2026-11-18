# MacroDNA

**Macro scouting for League of Legends, built from player trajectories.**
Entry for the *Cloud9 x JetBrains: Sky's The Limit Hackathon 2026*, Category 2 (LoL): Macro Scouting & Draft Management.

Public LoL stats show *what* happened. Coaches need to know *how a team plays*: where the jungler
starts, how early a team sets up for an objective, what it does after losing one. MacroDNA reads the
official GRID event feeds, which carry the position of all ten players roughly once per second, and turns
them into an opponent **fingerprint** plus **tells**: conditional behaviours, each backed by evidence
(series, game, clock time) and an honest sample size.

> **Status:** early development. See [docs/roadmap.md](docs/roadmap.md).

## What it will do

- **Jungle route fingerprint.** First-3-minute routes classified from trajectories.
- **Objective setup radar.** How early and how many players a team has in position before Baron, drakes, grubs and Herald.
- **Tells.** "After losing the second drake, they take Herald within 60 s in 71 % of games (n = 23)", each linked to its source games.
- **2D replay** with detected macro events annotated on the timeline.
- **Style twins.** Which other teams play like this one.

## Run it

Requires Python 3.13+ with [uv](https://docs.astral.sh/uv/), and Node 20+ for the web UI.

```bash
# 1. Clone the hackathon data OUTSIDE this project (it is proprietary, never commit it)
git clone https://github.com/cloud9esports/stl-hackathon-2026-grid-starter.git ../stl-hackathon-2026-grid-starter

# 2. Install and check the data is found
uv sync
uv run macrodna doctor
```

The data location is read from `STL_DATA_DIR` (default `../stl-hackathon-2026-grid-starter`). All derived data is
written to `private/cache/`, which is gitignored.

## Data license

The GRID data is proprietary, licensed for the hackathon only, and is **not** part of this repository.
This repo contains source code, documentation and aggregate results only.
Match data is provided by GRID. This project is not endorsed by Riot Games or Cloud9.

## License

[MIT](LICENSE), covering the source code only.
