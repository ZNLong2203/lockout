// Live draft win probability in the browser: the logistic model from src/lockout/draft/winmodel.py, applied to
// the draft as entered. Features are blue minus red and defined for a partial draft, so the bar moves pick by pick.
import type { WinModel } from "../api/types";
import type { Meta } from "./copilot";
import { analyseTeam, assignPicks, draftList, lockedBefore, type GameDraft, type SeriesContext, type Side, type TeamCtx } from "./draft";

const MIN_HISTORY = 8; // players with less history have no pool in the model (src/lockout/draft/pools.py)

export const champEdge = (wins: number, picks: number, prior = 10) => (wins + prior) / (picks + 2 * prior) - 0.5;

function sideFeatures(team: TeamCtx, picks: string[], locked: Set<string>, meta: Meta | undefined, elo: number, prior: number) {
  const assigned = assignPicks(team, picks, (c) => meta?.get(c)?.role);
  let comfort = 0;
  let champ = 0;
  for (const c of picks) {
    const player = team.players.find((p) => assigned.get(p.player_id) === c);
    if (player && player.history >= MIN_HISTORY) comfort += player.pool.find((e) => e.champion === c)?.share ?? 0;
    const m = meta?.get(c);
    champ += champEdge(m?.wins ?? 0, m?.picks ?? 0, prior);
  }
  const trusted = { ...team, players: team.players.filter((p) => p.history >= MIN_HISTORY) };
  const masses = analyseTeam(trusted, locked).map((s) => s.mass);
  return { elo: elo / 400, comfort: comfort / 5, champ: champ / 5, stress: masses.length ? Math.min(...masses) : 0 };
}

/** P(we win) for games[index] as drafted so far, or with `extra` added to one side's picks (what-if). */
export function winChance(
  model: WinModel,
  ctx: SeriesContext,
  games: GameDraft[],
  index: number,
  meta?: Meta,
  extra?: { side: Side; champion: string },
): number {
  const game = games[index] as GameDraft;
  const locked = lockedBefore(games, index);
  const picks = (side: Side) => {
    const list = draftList(game, side, "pick").filter((c): c is string => !!c && c !== "—");
    return extra && extra.side === side ? [...list, extra.champion] : list;
  };
  const usSide = game.ourSide;
  const themSide: Side = usSide === "blue" ? "red" : "blue";
  const us = sideFeatures(ctx.ours, picks(usSide), locked, meta, model.ours_elo, model.prior);
  const them = sideFeatures(ctx.opponent, picks(themSide), locked, meta, model.opponent_elo, model.prior);
  const [blue, red] = usSide === "blue" ? [us, them] : [them, us];
  const x = model.features.map((f) => (blue[f as keyof typeof blue] ?? 0) - (red[f as keyof typeof red] ?? 0));
  const logit = model.intercept + x.reduce((acc, v, i) => acc + (model.coef[i] ?? 0) * ((v - (model.mean[i] ?? 0)) / (model.scale[i] || 1)), 0);
  const pBlue = 1 / (1 + Math.exp(-logit));
  return usSide === "blue" ? pBlue : 1 - pBlue;
}

/** The win chance after each step of the current game so far (index 0 = before any pick). */
export function winTimeline(model: WinModel, ctx: SeriesContext, games: GameDraft[], index: number, meta?: Meta): number[] {
  const game = games[index] as GameDraft;
  const filled = game.steps.filter((s) => s !== null).length;
  return Array.from({ length: filled + 1 }, (_, k) => {
    const g = { ...game, steps: game.steps.map((c, i) => (i < k ? c : null)) };
    return winChance(model, ctx, [...games.slice(0, index), g], index, meta);
  });
}
