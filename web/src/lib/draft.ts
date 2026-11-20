// Fearless draft model used by the board. The maths mirrors src/macrodna/draft/pools.py so the board can react
// instantly to every click; the API supplies the pools and the forecast.
import type {
  ContextPlayer,
  ContextPoolEntry,
  ContextTeam,
  PoolStatus,
  RecentGame,
  Role,
  SeriesContext as ApiSeriesContext,
  Side as ApiSide,
} from "../api/types";

export type Side = ApiSide;
export type Action = "ban" | "pick";

// Tournament draft order: 6 bans, 6 picks, 4 bans, 4 picks.
export const ORDER: { side: Side; action: Action }[] = [
  ...(["blue", "red", "blue", "red", "blue", "red"] as Side[]).map((side) => ({ side, action: "ban" as Action })),
  ...(["blue", "red", "red", "blue", "blue", "red"] as Side[]).map((side) => ({ side, action: "pick" as Action })),
  ...(["red", "blue", "red", "blue"] as Side[]).map((side) => ({ side, action: "ban" as Action })),
  ...(["red", "blue", "blue", "red"] as Side[]).map((side) => ({ side, action: "pick" as Action })),
];

export type PoolEntry = ContextPoolEntry;
export type PlayerPool = ContextPlayer;
export type TeamCtx = ContextTeam;

export interface GameDraft {
  number: number;
  ourSide: Side;
  steps: (string | null)[]; // 20 entries following ORDER
  winner: "us" | "them" | null;
}

export type PastGame = RecentGame;

/** The API context plus the games the coach has entered so far (the last one is being drafted). */
export interface SeriesContext extends ApiSeriesContext {
  games: GameDraft[];
}

export const emptyDraft = (number: number, ourSide: Side): GameDraft => ({
  number,
  ourSide,
  steps: Array<string | null>(ORDER.length).fill(null),
  winner: null,
});

export const sideOf = (g: GameDraft, who: "us" | "them"): Side =>
  who === "us" ? g.ourSide : g.ourSide === "blue" ? "red" : "blue";

export function draftList(g: GameDraft, side: Side, action: Action): (string | null)[] {
  return ORDER.map((o, i) => (o.side === side && o.action === action ? g.steps[i] ?? null : undefined)).filter(
    (x): x is string | null => x !== undefined,
  );
}

export const nextStep = (g: GameDraft) => g.steps.findIndex((s) => s === null);

/** Champions picked in earlier games of the series: locked for both teams under Fearless. */
export function lockedBefore(games: GameDraft[], index: number): Set<string> {
  const out = new Set<string>();
  games.slice(0, index).forEach((g) => ORDER.forEach((o, i) => o.action === "pick" && g.steps[i] && out.add(g.steps[i] as string)));
  return out;
}

export function usedIn(g: GameDraft): Set<string> {
  return new Set(g.steps.filter((s): s is string => s !== null));
}

const CRITICAL = 0.35;
const THIN = 0.6;
export const classify = (mass: number): PoolStatus => (mass < CRITICAL ? "critical" : mass < THIN ? "thin" : "ok");

export interface RoleState {
  player: PlayerPool;
  mass: number; // share of the pool still available
  status: PoolStatus;
  available: PoolEntry[];
}

export function analyseTeam(team: TeamCtx, unavailable: Set<string>): RoleState[] {
  return team.players
    .map((player) => {
      const available = player.pool.filter((e) => !unavailable.has(e.champion));
      const mass = available.reduce((s, e) => s + e.share, 0);
      return { player, mass, status: classify(mass), available };
    })
    .sort((a, b) => a.mass - b.mass);
}

export interface BanIdea {
  champion: string;
  role: Role;
  player: string;
  bite: number; // share of what that player has left
}

/** Bans that remove the biggest part of what the most fragile players still have. */
export function banIdeas(states: RoleState[], k = 4): BanIdea[] {
  return states
    .slice(0, 3)
    .flatMap((s) =>
      s.available.slice(0, 3).map((e) => ({ champion: e.champion, role: s.player.role, player: s.player.name, bite: s.mass ? e.share / s.mass : 0 })),
    )
    .sort((a, b) => b.bite - a.bite)
    .slice(0, k);
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
