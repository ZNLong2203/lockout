"""Command line entry point: ``uv run macrodna --help``."""

from __future__ import annotations

import typer

from macrodna.config import load_settings

app = typer.Typer(help="MacroDNA: macro scouting for League of Legends.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """Keep ``macrodna`` a command group even while it has a single subcommand."""


@app.command()
def doctor() -> None:
    """Check that the hackathon data is reachable and safely outside the repo."""
    settings = load_settings()
    typer.echo(f"data dir : {settings.data_dir}")
    typer.echo(f"cache dir: {settings.cache_dir}")
    try:
        settings.validate()
    except (FileNotFoundError, RuntimeError) as exc:
        typer.secho(f"FAIL: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from exc
    n_series = sum(1 for _ in settings.lol_dir.glob("events_*_grid.jsonl.zst"))
    typer.secho(f"OK: {n_series} LoL series files found.", fg=typer.colors.GREEN)


@app.command()
def etl(
    limit: int = typer.Option(0, help="Only process the first N series (0 = all)."),
    workers: int = typer.Option(0, help="Worker processes (0 = cores - 1)."),
) -> None:
    """Build the local Parquet cache (positions, events, draft) from the GRID feeds."""
    from pathlib import Path

    from macrodna.etl.build import build_cache
    from macrodna.roles import write_roles

    settings = load_settings()
    summary = build_cache(settings, limit=limit or None, workers=workers or None)
    typer.echo(
        f"series={summary['series']} games={summary['games']} events={summary['events']} "
        f"-> {summary['out']}"
    )
    n_roles = write_roles(Path(summary["out"]))
    typer.echo(f"roles inferred for {n_roles // 5} team-games")
    for series_id, err in summary["failures"]:
        typer.secho(f"FAILED series {series_id}: {err}", fg=typer.colors.RED, err=True)
    if summary["failures"]:
        raise typer.Exit(1)


@app.command()
def detect() -> None:
    """Run the macro detectors over the cache and write their result tables."""
    from macrodna.detectors.jungle import write_jungle
    from macrodna.detectors.objectives import write_objectives
    from macrodna.detectors.tells import write_tells

    settings = load_settings()
    out = settings.cache_dir / "lol"
    if not (out / "roles.parquet").exists():
        typer.secho("No cache found: run `macrodna etl` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    typer.echo(f"jungle fingerprints: {write_jungle(out)} junglers")
    typer.echo(f"objective setups: {write_objectives(out)} team-objective rows")
    n_tells, n_evidence = write_tells(out)
    typer.echo(f"tells: {n_tells} scored (team x template), {n_evidence} evidence rows")


@app.command()
def draft_build() -> None:
    """Build the enriched draft table used by the draft features."""
    from macrodna.draft.enrich import build_draft_table

    settings = load_settings()
    out = settings.cache_dir / "lol"
    if not (out / "roles.parquet").exists():
        typer.secho("No cache found: run `macrodna etl` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    from dataclasses import asdict

    from macrodna.draft.analysis import load_picks, write_backtest
    from macrodna.draft.tendencies import pick_depth_by_game

    n = build_draft_table(out, settings.meta_dir, settings.lol_dir)
    typer.echo(f"draft table: {n} actions")
    depth = [asdict(d) for d in pick_depth_by_game(load_picks(out))]
    summary = write_backtest(out, extra={"pick_depth": depth})
    pair = summary["pairwise"]
    typer.echo(
        f"backtest: more comfortable pool wins {pair['rate']:.1%} (n={pair['n']}, p={pair['p_value']:.3f})"  # type: ignore[index]
    )


@app.command()
def plan(
    team: str = typer.Argument(..., help="Our team, part of the name (e.g. 'Cloud9')."),
    opponent: str = typer.Argument(..., help="Opponent, part of the name."),
    locked: str = typer.Option(
        "", help="Champions already picked in earlier games, comma separated."
    ),
    banned: str = typer.Option("", help="Champions banned in the current draft, comma separated."),
) -> None:
    """Fearless series planner: pool state, ban targets and a forecast for both teams."""
    from macrodna.draft.planner import PickIndex, plan_series
    from macrodna.report import format_plan, resolve_team

    settings = load_settings()
    cache = settings.cache_dir / "lol"
    index = PickIndex.load(cache)
    ours, theirs = resolve_team(settings, index, team), resolve_team(settings, index, opponent)
    result = plan_series(
        index,
        ours[0],
        theirs[0],
        {c.strip() for c in locked.split(",") if c.strip()},
        {c.strip() for c in banned.split(",") if c.strip()},
    )
    typer.echo(format_plan(result, ours[1], theirs[1], cache))


@app.command()
def tendencies(
    team: str = typer.Argument(..., help="Team, part of the name."),
    scope: str = typer.Option("all", help="all | g1 (first games) | later (games 2+)"),
    top: int = typer.Option(8, help="Rows per list."),
) -> None:
    """Pick/ban tendencies of a team versus the league, and how its draft shifts in Fearless games."""
    from macrodna.draft.analysis import load_picks
    from macrodna.draft.planner import PickIndex
    from macrodna.draft.tendencies import (
        ban_role_targeting,
        load_draft_rows,
        pick_depth_by_game,
        team_tendencies,
    )
    from macrodna.report import resolve_team

    settings = load_settings()
    cache = settings.cache_dir / "lol"
    team_id, name = resolve_team(settings, PickIndex.load(cache), team)
    rows = load_draft_rows(cache)
    tend = team_tendencies(rows, team_id, scope)
    typer.echo(f"== {name} ({scope}): {tend[0].team_games if tend else 0} games ==")
    for action in ("ban", "pick"):
        typer.echo(
            f"\n-- most distinctive {action}s (rate vs league, q = false-discovery adjusted) --"
        )
        for t in [t for t in tend if t.action == action][:top]:
            typer.echo(
                f"  {t.champion:<14} {t.count:>3}/{t.team_games:<3} = {t.rate:>4.0%}  league {t.league_rate:>4.0%}  "
                f"{t.direction:<5} q={t.q:.3f} [{t.strength}]"
            )
    typer.echo(
        "\n-- what their bans aim at (share of bans by the targeted champion's usual role) --"
    )
    for role, (mine, league, n) in ban_role_targeting(rows, team_id, scope).items():
        typer.echo(f"  {role:<8} {mine:>4.0%}  league {league:>4.0%}  (n={n})")
    picks = load_picks(cache)
    typer.echo(
        "\n-- Fearless shift: how far down their pool they reach (1 = most played champion) --"
    )
    league_depth = {d.game_number: d for d in pick_depth_by_game(picks)}
    for d in pick_depth_by_game(picks, team_id):
        lg = league_depth.get(d.game_number)
        typer.echo(
            f"  game {d.game_number}: mean rank {d.mean_rank:.1f} (league {lg.mean_rank:.1f}), "
            f"new champions {d.share_new:.0%} (league {lg.share_new:.0%}), n={d.picks} picks"  # type: ignore[union-attr]
        )


if __name__ == "__main__":
    app()
