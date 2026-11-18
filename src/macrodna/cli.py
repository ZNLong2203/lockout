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


if __name__ == "__main__":
    app()
