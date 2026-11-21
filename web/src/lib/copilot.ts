// The draft co-pilot: for the step being drafted, the three best moves for us, or the three most likely moves
// of the opponent. Pure and deterministic, so the same function also scores a real series step by step
// (`callRate`): did the real choice appear in the co-pilot's top three before it was made?
//
// Every suggestion says why, in one line, and carries the sample it rests on.
import type { ChampionStats, Role } from "../api/types";
import { composition, fills } from "./comp";
import type { ChampInfo } from "./ddragon";
import {
  ORDER,
  analyseTeam,
  assignPicks,
  draftList,
  lockedBefore,
  nextStep,
  pct,
  sideOf,
  usedIn,
  type Action,
  type GameDraft,
  type RoleState,
  type SeriesContext,
  type Side,
} from "./draft";

export type Meta = ReadonlyMap<string, ChampionStats>;

export interface Suggestion {
  champion: string;
  score: number;
  title: string;
  reason: string;
  evidence: string;
  player?: string;
  role?: Role;
  tags: ("comfort" | "deny" | "ban-risk" | "comp" | "habit" | "fragile")[];
}

export interface StepAdvice {
  step: number;
  side: Side;
  action: Action;
  ours: boolean;
  team: string;
  suggestions: Suggestion[];
}

export interface Options {
  meta?: Meta;
  info?: (champion: string) => ChampInfo | undefined;
  k?: number;
  /** Override the learned weights per step type ("ban-us", "pick-them", ...): used by training. */
  weights?: Record<string, number[]>;
  /** Receives every candidate's features before ranking: used by training. */
  trace?: (t: Trace) => void;
}

const ROLE_WORD: Record<string, string> = { top: "top", jungle: "jungler", mid: "mid", adc: "ADC", support: "support", unknown: "player" };

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  list.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1));
  return m;
}

const open = (states: RoleState[], assigned: Map<string, string>) => states.filter((s) => !assigned.has(s.player.player_id));

/** The features of one candidate champion at one step, in this order (see docs/methodology.md). */
export const FEATURES = [
  "pool", // max share of an open player's remaining comfort (picks: the acting team; bans: the target team)
  "poolGames", // log(1 + games) that player has on it
  "roleMeta", // max share of the league's recent picks in an open player's role
  "banRate", // league ban rate
  "pickRate", // league pick rate
  "theirPicks", // share of the opponent's last games where they picked it
  "theirBans", // share of the opponent's last games where they banned it
  "other", // picks: max share of a rival's remaining comfort (deny); bans: of the acting team's own comfort
  "fragile", // 1 - pool left, for the player it matters most to
  "winEdge", // shrunk league win rate - 0.5
  "flex", // open players who have it in their pool / 5
] as const;

/**
 * Softmax ranking weights per step type, learned on the 80 most recent real series with
 * `npm run train:copilot` and checked once on 58 older ones (docs/methodology.md). They are 44 aggregate
 * numbers, not data.
 */
export const LEARNED: Record<string, number[]> = {
  "ban-them": [0.677, 0.398, 1.118, 3.852, 0.708, 0.215, 2.077, -0.266, 0.657, 0.238, 0.582],
  "ban-us": [0.792, 0.363, 1.556, 4.324, 0.998, 1.42, 1.061, -0.136, 0.46, 0.183, 0.424],
  "pick-them": [0.457, 0.498, 2.468, 2.557, 1.478, 1.393, 0.753, -0.202, 0.762, 0.305, 0.547],
  "pick-us": [0.728, 0.392, 2.502, 1.971, 1.887, 1.03, 1.015, 0.045, 0.952, 0.447, 0.699],
};

interface MetaIndex {
  rolePick: Map<string, Map<string, number>>; // role -> champion -> picks in that role
}

const metaCache = new WeakMap<object, MetaIndex>();

function indexMeta(meta: Meta | undefined): MetaIndex {
  const out: MetaIndex = { rolePick: new Map() };
  if (!meta) return out;
  const cached = metaCache.get(meta);
  if (cached) return cached;
  meta.forEach((c) =>
    Object.entries(c.roles).forEach(([role, share]) => {
      if (!out.rolePick.has(role)) out.rolePick.set(role, new Map());
      out.rolePick.get(role)?.set(c.champion, c.picks * share);
    }),
  );
  metaCache.set(meta, out);
  return out;
}

/** Normalise a champion -> weight map over the champions still available. */
function norm(m: Map<string, number> | undefined, unavailable: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  if (!m) return out;
  let total = 0;
  m.forEach((v, c) => !unavailable.has(c) && (total += v));
  if (total > 0) m.forEach((v, c) => !unavailable.has(c) && out.set(c, v / total));
  return out;
}

export interface Trace {
  key: string;
  champions: string[];
  X: number[][];
}

/** Advice for the next empty step of `games[index]`; null when the draft is complete. */
export function advise(ctx: SeriesContext, games: GameDraft[], index: number, opts: Options = {}): StepAdvice | null {
  const game = games[index];
  if (!game) return null;
  const step = nextStep(game);
  if (step < 0) return null;
  const o = ORDER[step] as (typeof ORDER)[number];
  const k = opts.k ?? 3;
  const usSide = sideOf(game, "us");
  const themSide = sideOf(game, "them");
  const ours = o.side === usSide;
  const key = `${o.action}-${ours ? "us" : "them"}`;
  const w = opts.weights?.[key] ?? (LEARNED[key] as number[]);
  const meta = opts.meta;
  const mi = indexMeta(meta);
  const roleOf = (c: string) => meta?.get(c)?.role;
  const unavailable = new Set([...lockedBefore(games, index), ...usedIn(game)]);
  const ourPicks = draftList(game, usSide, "pick").filter((c): c is string => !!c);
  const theirPicks = draftList(game, themSide, "pick").filter((c): c is string => !!c);
  const usOpen = open(analyseTeam(ctx.ours, unavailable), assignPicks(ctx.ours, ourPicks, roleOf));
  const themOpen = open(analyseTeam(ctx.opponent, unavailable), assignPicks(ctx.opponent, theirPicks, roleOf));
  const recent = ctx.opponent_recent;
  const R = Math.max(recent.length, 1);
  const recentPicks = counts(recent.flatMap((g) => g.picks.map((p) => p.champion)));
  const recentBans = counts(recent.flatMap((g) => g.bans));
  const acting = ours ? usOpen : themOpen;
  const target = ours ? themOpen : usOpen;
  const relevant = o.action === "pick" ? acting : target; // whose pool the move is about
  const other = o.action === "pick" ? target : acting;
  const roleDist = new Map(relevant.map((s) => [s.player.role, norm(mi.rolePick.get(s.player.role), unavailable)]));
  const share = (s: RoleState, c: string) => (s.mass > 0 ? (s.available.find((e) => e.champion === c)?.share ?? 0) / s.mass : 0);

  const names = new Set<string>([...(meta ? [...meta.keys()] : []), ...[...usOpen, ...themOpen].flatMap((s) => s.available.map((e) => e.champion))]);
  const champions = [...names].filter((c) => !unavailable.has(c) && c !== "—");
  const X: number[][] = [];
  const why: { sb?: RoleState; sr?: RoleState; rival?: RoleState; games: number }[] = [];
  for (const c of champions) {
    let f0 = 0;
    let sb: RoleState | undefined;
    for (const s of relevant) {
      const v = share(s, c);
      if (v > f0) [f0, sb] = [v, s];
    }
    let f2 = 0;
    let sr: RoleState | undefined;
    for (const s of relevant) {
      const v = roleDist.get(s.player.role)?.get(c) ?? 0;
      if (v > f2) [f2, sr] = [v, s];
    }
    let f7 = 0;
    let rival: RoleState | undefined;
    for (const s of other) {
      const v = share(s, c);
      if (v > f7) [f7, rival] = [v, s];
    }
    const m = meta?.get(c);
    const games = sb?.available.find((e) => e.champion === c)?.games ?? 0;
    X.push([
      f0,
      Math.log1p(games),
      f2,
      m && m.games ? m.bans / m.games : 0,
      m && m.games ? m.picks / m.games : 0,
      (recentPicks.get(c) ?? 0) / R,
      (recentBans.get(c) ?? 0) / R,
      f7,
      sb ? 1 - sb.mass : 0,
      m ? (m.wins + 10) / (m.picks + 20) - 0.5 : 0,
      relevant.filter((s) => s.available.some((e) => e.champion === c)).length / 5,
    ]);
    why.push({ sb, sr, rival, games });
  }
  opts.trace?.({ key, champions, X });

  const scores = X.map((x) => x.reduce((acc, v, i) => acc + v * (w[i] ?? 0), 0));
  const order = scores.map((_, i) => i).sort((a, b) => (scores[b] as number) - (scores[a] as number) || (champions[a] as string).localeCompare(champions[b] as string));
  const comp = ours && o.action === "pick" ? composition(ourPicks, opts.info ?? (() => undefined)) : null;
  const suggestions = order.slice(0, k).map((i) => explain(champions[i] as string, X[i] as number[], w, why[i] as (typeof why)[number], scores[i] as number));

  function explain(c: string, x: number[], wt: number[], y: (typeof why)[number], score: number): Suggestion {
    const m = meta?.get(c);
    const contrib = x.map((v, i) => ({ i, v: v * (wt[i] ?? 0) })).filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
    const bits: string[] = [];
    const tags: Suggestion["tags"] = [];
    const theirs = o.action === "pick" ? !ours : ours; // the relevant players belong to the opponent
    for (const { i } of contrib) {
      if (bits.length >= 2) break;
      if ((i === 0 || i === 1) && y.sb && !bits.some((b) => b.includes(y.sb?.player.name ?? "\u0000"))) {
        bits.push(
          o.action === "pick"
            ? `${pct(x[0] ?? 0)} of ${y.sb.player.name}'s comfort left`
            : `${pct(x[0] ?? 0)} of what ${theirs ? "their" : "our"} ${ROLE_WORD[y.sb.player.role]} ${y.sb.player.name} has left`,
        );
      } else if (i === 2 && y.sr) bits.push(`league: ${pct(x[2] ?? 0)} of recent ${ROLE_WORD[y.sr.player.role]} picks`);
      else if (i === 3 && m) bits.push(`banned in ${pct(x[3] ?? 0)} of league games`);
      else if (i === 4 && m) bits.push(`picked in ${pct(x[4] ?? 0)} of league games`);
      else if (i === 5) bits.push(`picked in ${recentPicks.get(c)} of their last ${R}`);
      else if (i === 6) bits.push(`they banned it ${recentBans.get(c)}/${R} recently`);
      else if (i === 7 && y.rival && o.action === "pick")
        bits.push((x[7] ?? 0) >= 0.9 ? `takes ${y.rival.player.name}'s last comfort pick` : `takes ${pct(x[7] ?? 0)} of what ${y.rival.player.name} has left`);
      else if (i === 8 && y.sb) bits.push(`${y.sb.player.name}'s pool is down to ${pct(y.sb.mass)}`);
      else if (i === 9 && m) bits.push(`${pct((m.wins + 10) / (m.picks + 20))} league win rate`);
      else if (i === 10 && (x[10] ?? 0) >= 0.4) bits.push(`flex: ${Math.round((x[10] ?? 0) * 5)} players play it`);
    }
    if ((x[0] ?? 0) > 0) {
      if (o.action === "pick") tags.push("comfort");
      else if (y.sb && y.sb.status !== "ok") tags.push("fragile");
    }
    if (o.action === "pick" && ours && (x[7] ?? 0) > 0.05) tags.push("deny");
    if ((x[5] ?? 0) > 0 || (x[6] ?? 0) > 0) tags.push(ours && o.action === "pick" ? "ban-risk" : "habit");
    const fit = comp ? fills(comp, opts.info?.(c), c) : null;
    if (fit) {
      tags.push("comp");
      if (bits.length < 2) bits.push(fit);
    }
    const lead = contrib[0]?.i;
    const player = y.sb ?? y.sr;
    return {
      champion: c,
      score,
      title: o.action === "ban" ? (ours ? `Ban ${c}` : `They may ban ${c}`) : ours ? `Pick ${c}` : `Likely ${c}`,
      reason: bits.join(" · ") || "league pattern",
      evidence:
        (lead === 0 || lead === 1 || lead === 8) && y.sb ? `n = ${y.games} games by ${y.sb.player.name}` : m ? `n = ${m.games} league games` : `n = ${R} games`,
      player: player?.player.name,
      role: player?.player.role,
      tags,
    };
  }

  return { step, side: o.side, action: o.action, ours, team: ours ? ctx.ours.name : ctx.opponent.name, suggestions };
}

export interface CallRate {
  hits: number;
  total: number;
  /** Per step of games[index]: true = the real choice was in the top 3, false = it was not, null = not drafted. */
  steps: (boolean | null)[];
  ours: { hits: number; total: number };
  theirs: { hits: number; total: number };
}

/**
 * How often the real choice was among the co-pilot's top three, scored only on information available before
 * each step (later steps of that game and later games are hidden while scoring it).
 */
export function callRate(ctx: SeriesContext, games: GameDraft[], index: number, opts: Options = {}): CallRate {
  const out: CallRate = { hits: 0, total: 0, steps: Array<boolean | null>(ORDER.length).fill(null), ours: { hits: 0, total: 0 }, theirs: { hits: 0, total: 0 } };
  for (let gi = 0; gi <= index && gi < games.length; gi++) {
    const g = games[gi] as GameDraft;
    for (let s = 0; s < ORDER.length; s++) {
      const actual = g.steps[s];
      if (!actual) continue;
      const before: GameDraft = { ...g, steps: g.steps.map((c, i) => (i < s ? c : null)), winner: null };
      // a missed ban earlier in the game leaves a hole; fill it with a placeholder so the step lines up
      before.steps = before.steps.map((c, i) => (i < s && c === null ? "—" : c));
      const advice = advise(ctx, [...games.slice(0, gi), before], gi, opts);
      if (!advice || advice.step !== s) continue;
      const hit = advice.suggestions.some((x) => x.champion === actual);
      const bucket = advice.ours ? out.ours : out.theirs;
      bucket.total++;
      out.total++;
      if (hit) {
        bucket.hits++;
        out.hits++;
      }
      if (gi === index) out.steps[s] = hit;
    }
  }
  return out;
}
