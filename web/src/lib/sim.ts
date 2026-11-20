// Monte Carlo forecast of the rest of a Fearless series, in the browser so it reacts to every click.
// Same model as src/lockout/draft/simulate.py (validated there against real series, within 3 points):
// every player picks from their own pool with probability = pool share, picks are locked for both teams.
// Differences: it starts from the series as entered (locked champions and the picks already made in the
// current game), and it uses the draft-room pools (each player's top 8 champions).
import type { TeamCtx } from "./draft";

export const CRITICAL = 0.35;

/** Deterministic PRNG (mulberry32) so the forecast does not flicker between renders. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlayerForecast {
  player_id: string;
  name: string;
  role: string;
  team: "ours" | "opponent";
  /** Comfort pool left at the start of each forecast game (index 0 = `fromGame`). */
  mass: number[];
  pCritical: number[];
}

export interface SeriesForecast {
  fromGame: number;
  games: number[];
  players: PlayerForecast[];
  nSims: number;
}

interface Input {
  ours: TeamCtx;
  opponent: TeamCtx;
  locked: Set<string>; // champions picked in finished games
  current: Set<string>; // picks already made in the current game (they lock for later games)
  bannedNow?: Set<string>; // bans of the current game (unavailable in it, free again afterwards)
  filled: Set<string>; // player ids who already picked in the current game
  fromGame: number;
  lastGame: number;
  nSims?: number;
  seed?: number;
}

const massOf = (pool: { champion: string; share: number }[], locked: Set<string>) =>
  pool.reduce((s, e) => (locked.has(e.champion) ? s : s + e.share), 0);

/** Comfort left for each player at the start of games fromGame..lastGame. */
export function forecastSeries({ ours, opponent, locked, current, bannedNow = new Set(), filled, fromGame, lastGame, nSims = 300, seed = 7 }: Input): SeriesForecast {
  const players = [
    ...ours.players.map((p) => ({ p, team: "ours" as const })),
    ...opponent.players.map((p) => ({ p, team: "opponent" as const })),
  ];
  const games = Array.from({ length: Math.max(0, lastGame - fromGame + 1) }, (_, i) => fromGame + i);
  const acc = players.map(() => games.map(() => [] as number[]));
  const rand = rng(seed);
  for (let sim = 0; sim < nSims; sim++) {
    const lock = new Set(locked);
    games.forEach((_, g) => {
      players.forEach(({ p }, i) => (acc[i] as number[][])[g]?.push(massOf(p.pool, lock)));
      // play out game g: the current game keeps the picks already made
      const taken = new Set(g === 0 ? current : []);
      const order = players.map((_, i) => i).filter((i) => !(g === 0 && filled.has((players[i] as (typeof players)[number]).p.player_id)));
      for (let k = order.length - 1; k > 0; k--) {
        const j = Math.floor(rand() * (k + 1));
        [order[k], order[j]] = [order[j] as number, order[k] as number];
      }
      for (const i of order) {
        const pool = (players[i] as (typeof players)[number]).p.pool.filter(
          (e) => !lock.has(e.champion) && !taken.has(e.champion) && !(g === 0 && bannedNow.has(e.champion)),
        );
        const total = pool.reduce((s, e) => s + e.share, 0);
        if (!total) continue;
        let r = rand() * total;
        const choice = pool.find((e) => (r -= e.share) <= 0) ?? pool[pool.length - 1];
        if (choice) taken.add(choice.champion);
      }
      taken.forEach((c) => lock.add(c));
    });
  }
  return {
    fromGame,
    games,
    nSims,
    players: players.map(({ p, team }, i) => ({
      player_id: p.player_id,
      name: p.name,
      role: p.role,
      team,
      mass: (acc[i] as number[][]).map((v) => v.reduce((s, x) => s + x, 0) / Math.max(v.length, 1)),
      pCritical: (acc[i] as number[][]).map((v) => v.filter((x) => x < CRITICAL).length / Math.max(v.length, 1)),
    })),
  };
}

/** The most urgent warning per team: the player most likely to be out of comfort picks before the series ends. */
export function budgetAlerts(f: SeriesForecast, minP = 0.35): { player: PlayerForecast; game: number; p: number }[] {
  const out: { player: PlayerForecast; game: number; p: number }[] = [];
  for (const team of ["opponent", "ours"] as const) {
    let best: { player: PlayerForecast; game: number; p: number } | null = null;
    for (const pl of f.players.filter((x) => x.team === team)) {
      const g = pl.pCritical.findIndex((p) => p >= minP);
      if (g < 0) continue;
      const cand = { player: pl, game: f.games[g] as number, p: pl.pCritical[g] as number };
      if (!best || cand.game < best.game || (cand.game === best.game && cand.p > best.p)) best = cand;
    }
    if (best) out.push(best);
  }
  return out;
}

