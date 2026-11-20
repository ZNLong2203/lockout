"""Plain-text rendering of a series plan (used by the CLI; the web app renders the same data)."""

from __future__ import annotations

import csv
from pathlib import Path

import typer

from lockout.config import Settings
from lockout.draft.planner import PickIndex, SeriesPlan, TeamState, jungle_bridge


def team_names(settings: Settings) -> dict[str, str]:
    with (settings.meta_dir / "teams.csv").open(encoding="utf-8") as fh:
        return {r["team_id"]: r["name"] for r in csv.DictReader(fh) if r["title"] == "lol"}


def resolve_team(settings: Settings, index: PickIndex, query: str) -> tuple[str, str]:
    hit = index.find_team(team_names(settings), query)
    if hit is None:
        raise typer.BadParameter(f"No team with picks matches '{query}'.")
    return hit


def _team_block(state: TeamState, name: str) -> list[str]:
    lines = [f"  {name}"]
    for r in state.runways:
        top = ", ".join(f"{c} {s:.0%}" for c, s in r.remaining[:3]) or "nothing left"
        lines.append(
            f"    {r.role:<8} pool left {r.mass:>4.0%} [{r.status:<8}] depth {r.depth}  "
            f"(history {r.history})  best left: {top}"
        )
    if state.ban_suggestions:
        lines.append(
            "    ban targets (fragile roles): "
            + "; ".join(
                f"{role}: {champ} ({share:.0%} of what is left)"
                for role, champ, share in state.ban_suggestions[:4]
            )
        )
    return lines


def format_plan(plan: SeriesPlan, our_name: str, opp_name: str, cache: Path) -> str:
    out = ["== Pool state now (share of each player's comfortable pool still available) =="]
    out += _team_block(plan.team, f"{our_name} (us)")
    out += _team_block(plan.opponent, f"{opp_name} (opponent)")
    f = plan.forecast
    if f:
        out.append(
            "\n== Forecast: probability a role is critical at the start of game N (fresh series) =="
        )
        for tid, name in ((plan.team.team_id, our_name), (plan.opponent.team_id, opp_name)):
            out.append(
                f"  {name}  mean stress by game: "
                + "  ".join(f"G{g + 1} {v:.2f}" for g, v in enumerate(f.mean_stress[tid]))
            )
            weakest = sorted(f.weakest_at_end[tid].items(), key=lambda kv: -kv[1])[:2]
            out.append(
                "    most likely weakest role by the last game: "
                + ", ".join(f"{r} {p:.0%}" for r, p in weakest)
            )
    jg = next((r for r in plan.opponent.runways if r.role == "jungle"), None)
    if jg and jg.remaining:
        out.append("\n== Macro bridge: if they play one of their remaining jungle champions ==")
        for champ, _ in jg.remaining[:3]:
            b = jungle_bridge(cache, champ, plan.opponent.team_id) or jungle_bridge(cache, champ)
            if b:
                scope = (
                    "this team"
                    if jungle_bridge(cache, champ, plan.opponent.team_id)
                    else "league-wide"
                )
                fl = b["first_lane"]
                out.append(
                    f"  {champ} ({scope}, n={b['n']}): opens top-side {b['start_top']:.0%} / bot-side {b['start_bot']:.0%}; "
                    f"first lane seen top {fl['top']:.0%} mid {fl['mid']:.0%} bot {fl['bot']:.0%}"  # type: ignore[index]
                    f", median {b['median_first_lane_t']} s"
                )
    out += [f"\nNote: {n}" for n in plan.notes]
    return "\n".join(out)
