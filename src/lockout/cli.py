"""Command line entry point: ``uv run lockout --help``."""

from __future__ import annotations

from pathlib import Path

import typer

from lockout.config import load_settings

app = typer.Typer(help="Lockout: macro scouting for League of Legends.", no_args_is_help=True)


@app.callback()
def main() -> None:
    """Keep ``lockout`` a command group even while it has a single subcommand."""


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

    from lockout.etl.build import build_cache
    from lockout.roles import write_roles

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
    from lockout.detectors.jungle import write_jungle
    from lockout.detectors.objectives import write_objectives
    from lockout.detectors.tells import write_tells

    settings = load_settings()
    out = settings.cache_dir / "lol"
    if not (out / "roles.parquet").exists():
        typer.secho("No cache found: run `lockout etl` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    typer.echo(f"jungle fingerprints: {write_jungle(out)} junglers")
    typer.echo(f"objective setups: {write_objectives(out)} team-objective rows")
    n_tells, n_evidence = write_tells(out)
    typer.echo(f"tells: {n_tells} scored (team x template), {n_evidence} evidence rows")


@app.command()
def draft_build() -> None:
    """Build the enriched draft table used by the draft features."""
    from lockout.draft.enrich import build_draft_table

    settings = load_settings()
    out = settings.cache_dir / "lol"
    if not (out / "roles.parquet").exists():
        typer.secho("No cache found: run `lockout etl` first.", fg=typer.colors.RED, err=True)
        raise typer.Exit(1)
    from dataclasses import asdict

    from lockout.draft.analysis import load_picks, write_backtest
    from lockout.draft.tendencies import pick_depth_by_game

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
    from lockout.draft.planner import PickIndex, plan_series
    from lockout.report import format_plan, resolve_team

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
    from lockout.draft.analysis import load_picks
    from lockout.draft.planner import PickIndex
    from lockout.draft.tendencies import (
        MIN_TEAM_GAMES,
        SCOPES,
        load_draft_rows,
        tendency_report,
    )
    from lockout.report import resolve_team

    if scope not in SCOPES:
        raise typer.BadParameter(f"scope must be one of {', '.join(SCOPES)}")
    settings = load_settings()
    cache = settings.cache_dir / "lol"
    team_id, name = resolve_team(settings, PickIndex.load(cache), team)
    report = tendency_report(load_draft_rows(cache), load_picks(cache), team_id, scope, top)
    if report is None:
        typer.secho(
            f"{name}: fewer than {MIN_TEAM_GAMES} games in scope '{scope}', no report.",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(1)
    typer.echo(f"== {name} ({scope}): {report.team_games} games ==")
    for action, items in (("ban", report.bans), ("pick", report.picks)):
        typer.echo(
            f"\n-- most distinctive {action}s (rate vs league, q = false-discovery adjusted) --"
        )
        for t in items:
            typer.echo(
                f"  {t.champion:<14} {t.count:>3}/{t.team_games:<3} = {t.rate:>4.0%}  league {t.league_rate:>4.0%}  "
                f"{t.direction:<5} q={t.q:.3f} [{t.strength}]"
            )
    typer.echo(
        "\n-- what their bans aim at (share of bans by the targeted champion's usual role) --"
    )
    for b in report.ban_targets:
        typer.echo(f"  {b.role:<8} {b.team_share:>4.0%}  league {b.league_share:>4.0%}  (n={b.n})")
    typer.echo(
        "\n-- Fearless shift: how far down their pool they reach (1 = most played champion) --"
    )
    for d in report.fearless_shift:
        league_rank = f"{d.league_mean_rank:.1f}" if d.league_mean_rank is not None else "n/a"
        league_new = f"{d.league_share_new:.0%}" if d.league_share_new is not None else "n/a"
        typer.echo(
            f"  game {d.game_number}: mean rank {d.mean_rank:.1f} (league {league_rank}), "
            f"new champions {d.share_new:.0%} (league {league_new}), n={d.picks} picks"
        )


@app.command()
def winmodel() -> None:
    """Score the live-draft win model on later games (time split) and print aggregates only."""
    from lockout.draft.analysis import load_picks
    from lockout.draft.winmodel import FEATURES, build_rows, evaluate, fit

    cache = load_settings().cache_dir / "lol"
    rows, _ = build_rows(cache, load_picks(cache))
    e = evaluate(rows)
    typer.echo(f"games: train {e.n_train}, test {e.n_test} (later games)")
    typer.echo(
        f"Elo + draft : accuracy {e.accuracy:.1%}, log loss {e.log_loss:.4f}, AUC {e.auc:.3f}"
    )
    typer.echo(
        f"Elo only    : accuracy {e.elo_accuracy:.1%}, log loss {e.elo_log_loss:.4f}, AUC {e.elo_auc:.3f}"
    )
    typer.echo(f"blue side   : {e.blue_rate:.1%} of training games, log loss {e.blue_log_loss:.4f}")
    typer.echo(
        f"confident   : {e.confident_accuracy:.1%} right on the {e.confident_n} games given 65 %+"
    )
    m = fit(rows)
    coefs = ", ".join(f"{f} {c:+.3f}" for f, c in zip(FEATURES, m.coef, strict=True))
    typer.echo(f"coefficients (standardised): {coefs}; intercept {m.intercept:+.3f}")


@app.command("copilot-train")
def copilot_train() -> None:
    """Train the co-pilot's LightGBM re-ranker (needs `uv sync --group ml` and `npm run export:features`)."""
    from lockout.draft.copilot_ranker import train

    try:
        ev = train(load_settings().cache_dir)
    except ImportError as exc:
        typer.secho(
            "FAIL: install the ml group first: uv sync --group ml", fg=typer.colors.RED, err=True
        )
        raise typer.Exit(1) from exc
    except FileNotFoundError as exc:
        typer.secho(
            f"FAIL: {exc}. Run `cd web && npm run export:features` first.",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(1) from exc
    typer.echo(
        f"held-out steps {int(ev['test_steps'])}, training steps {int(ev['train_steps'])}, trees {int(ev['trees'])}"
    )
    for k in (1, 3, 5, 10):
        typer.echo(f"top {k:>2}: trees {ev[f'top{k}']:.1%}   linear {ev[f'linear_top{k}']:.1%}")
    typer.echo(
        "top 3 by step: "
        + ", ".join(
            f"{key} {ev[f'top3_{key}']:.1%}"
            for key in ("ban-us", "ban-them", "pick-us", "pick-them")
        )
    )


PUBLIC_ROOT = Path(__file__).resolve().parents[2] / "private" / "cache" / "public"
PUBLIC_OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


@app.command("public-build")
def public_build(
    refresh: bool = typer.Option(False, help="Download again instead of using the raw cache."),
) -> None:
    """Build a draft cache from Leaguepedia's public data (CC BY-SA) for the hosted demo."""
    from dataclasses import asdict

    from lockout.draft.analysis import load_picks, write_backtest
    from lockout.draft.tendencies import pick_depth_by_game
    from lockout.public.leaguepedia import build, fetch

    rows = fetch(PUBLIC_ROOT / "raw" / "leaguepedia.json", refresh=refresh)
    stats = build(rows, PUBLIC_ROOT / "data", PUBLIC_ROOT / "cache")
    lol = PUBLIC_ROOT / "cache" / "lol"
    depth = [asdict(d) for d in pick_depth_by_game(load_picks(lol))]
    write_backtest(lol, extra={"pick_depth": depth})
    typer.secho(
        f"OK: {stats['games']} games, {stats['draft_actions']} draft actions ({stats['skipped']} skipped)",
        fg=typer.colors.GREEN,
    )


@app.command("public-export")
def public_export(
    logos: bool = typer.Option(True, help="Look up team logos on Leaguepedia."),
) -> None:
    """Export the public cache as static JSON for the hosted demo (web/public/data)."""
    from lockout.public.export import export

    stats = export(PUBLIC_ROOT, PUBLIC_OUT, logos=logos)
    typer.secho(
        f"OK: {stats['teams']} teams, {stats['series']} series, {stats['games']} games -> {PUBLIC_OUT}",
        fg=typer.colors.GREEN,
    )


@app.command()
def logos() -> None:
    """Look up team logos on Leaguepedia and cache their URLs (no images are stored)."""
    from lockout.api.queries import CacheNotReadyError, Repository
    from lockout.logos import resolve_logos, save_logos

    settings = load_settings()
    try:
        repo = Repository(settings)
    except CacheNotReadyError as exc:
        typer.secho(f"FAIL: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from exc
    names = sorted({n for n in repo.names.values() if n and not n.lower().startswith("tbd")})
    found = resolve_logos(names)
    path = save_logos(settings.cache_dir, found)
    typer.secho(
        f"OK: logos for {len(found)} of {len(names)} teams -> {path}", fg=typer.colors.GREEN
    )


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Interface to listen on."),
    port: int = typer.Option(8000, help="Port to listen on."),
) -> None:
    """Serve the read-only HTTP API over the local cache (docs at /docs)."""
    import uvicorn

    from lockout.api.app import create_app
    from lockout.api.queries import CacheNotReadyError

    try:
        api = create_app(load_settings())
    except CacheNotReadyError as exc:
        typer.secho(f"FAIL: {exc}", fg=typer.colors.RED, err=True)
        raise typer.Exit(1) from exc
    uvicorn.run(api, host=host, port=port)


if __name__ == "__main__":
    app()
