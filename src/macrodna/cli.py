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
    from macrodna.draft.analysis import write_backtest

    n = build_draft_table(out, settings.meta_dir, settings.lol_dir)
    typer.echo(f"draft table: {n} actions")
    summary = write_backtest(out)
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


if __name__ == "__main__":
    app()
