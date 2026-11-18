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

    settings = load_settings()
    out = settings.cache_dir / "lol"
    if not (out / "roles.parquet").exists():
        typer.secho("No cache found: run `macrodna etl` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    typer.echo(f"jungle fingerprints: {write_jungle(out)} junglers")


if __name__ == "__main__":
    app()
