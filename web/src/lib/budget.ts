// The Fearless budget table: comfort left per player and game, exact for games already played, forecast after.
import type { Meta } from "./copilot";
import { ORDER, analyseTeam, assignPicks, draftList, lockedBefore, pct, sideOf, type GameDraft, type SeriesContext } from "./draft";
import { budgetAlerts, forecastSeries, type SeriesForecast } from "./sim";

export interface BudgetCell {
  game: number;
  mass: number;
  risk: number | null; // P(critical) for forecast cells
  kind: "past" | "now" | "future";
  delta: number | null; // what-if change vs the base forecast
}

export interface BudgetRow {
  player_id: string;
  name: string;
  role: string;
  team: "ours" | "opponent";
  cells: BudgetCell[];
}

export interface Budget {
  rows: BudgetRow[];
  alerts: string[];
  whatIf: string | null;
  nSims: number;
}

const ROLE_WORD: Record<string, string> = { top: "top", jungle: "jungler", mid: "mid", adc: "ADC", support: "support" };

/** Inputs of the forecast for the game being drafted: what is locked, picked and banned, and who has picked. */
function state(ctx: SeriesContext, games: GameDraft[], index: number, meta?: Meta) {
  const game = games[index] as GameDraft;
  const roleOf = (c: string) => meta?.get(c)?.role;
  const usPicks = draftList(game, sideOf(game, "us"), "pick").filter((c): c is string => !!c);
  const themPicks = draftList(game, sideOf(game, "them"), "pick").filter((c): c is string => !!c);
  const filled = new Set([...assignPicks(ctx.ours, usPicks, roleOf).keys(), ...assignPicks(ctx.opponent, themPicks, roleOf).keys()]);
  const bannedNow = new Set(ORDER.map((o, i) => (o.action === "ban" ? game.steps[i] : null)).filter((c): c is string => !!c));
  return { game, locked: lockedBefore(games, index), current: new Set([...usPicks, ...themPicks]), bannedNow, filled };
}

export function buildBudget(ctx: SeriesContext, games: GameDraft[], index: number, meta?: Meta, whatIf: string | null = null, nSims = 300): Budget {
  const st = state(ctx, games, index, meta);
  const base = forecastSeries({ ours: ctx.ours, opponent: ctx.opponent, ...st, fromGame: st.game.number, lastGame: Math.max(ctx.format, st.game.number), nSims });
  let alt: SeriesForecast | null = null;
  if (whatIf && !st.locked.has(whatIf) && !st.current.has(whatIf) && !st.bannedNow.has(whatIf)) {
    // the champion goes to whoever plays it most, on either team
    const owner = [...ctx.ours.players, ...ctx.opponent.players]
      .filter((p) => !st.filled.has(p.player_id))
      .map((p) => ({ p, share: p.pool.find((e) => e.champion === whatIf)?.share ?? 0 }))
      .sort((a, b) => b.share - a.share)[0];
    alt = forecastSeries({
      ours: ctx.ours,
      opponent: ctx.opponent,
      ...st,
      current: new Set([...st.current, whatIf]),
      filled: owner && owner.share > 0 ? new Set([...st.filled, owner.p.player_id]) : st.filled,
      fromGame: st.game.number,
      lastGame: Math.max(ctx.format, st.game.number),
      nSims,
    });
  }
  const past = games.slice(0, index).map((g, j) => {
    const unavailable = lockedBefore(games, j);
    const masses = new Map<string, number>();
    [...analyseTeam(ctx.ours, unavailable), ...analyseTeam(ctx.opponent, unavailable)].forEach((r) => masses.set(r.player.player_id, r.mass));
    return { game: g.number, masses };
  });
  const rows: BudgetRow[] = base.players.map((p, i) => ({
    player_id: p.player_id,
    name: p.name,
    role: p.role,
    team: p.team,
    cells: [
      ...past.map((x) => ({ game: x.game, mass: x.masses.get(p.player_id) ?? 0, risk: null, kind: "past" as const, delta: null })),
      ...base.games.map((g, k) => ({
        game: g,
        mass: p.mass[k] as number,
        risk: k === 0 ? null : (p.pCritical[k] as number),
        kind: k === 0 ? ("now" as const) : ("future" as const),
        delta: alt && k > 0 ? (alt.players[i]?.mass[k] as number) - (p.mass[k] as number) : null,
      })),
    ],
  }));
  const alerts = budgetAlerts(base).map(
    ({ player, game, p }) =>
      `${player.team === "ours" ? "Our" : "Their"} ${ROLE_WORD[player.role] ?? player.role} ${player.name}: ${pct(p)} chance of being down to under a third of the comfort pool by game ${game}.`,
  );
  return { rows, alerts, whatIf: alt ? whatIf : null, nSims };
}
