// The draft co-pilot: for the step being drafted, the three best moves for us, or the three most likely moves
// of the opponent. Pure and deterministic, so the same function also scores a real series step by step
// (`callRate`): did the real choice appear in the co-pilot's top three before it was made?
//
// Every suggestion says why, in one line, and carries the sample it rests on.
import type { ChampionStats, Role } from "../api/types";
import { composition, fills } from "./comp";
import type { ChampInfo } from "./ddragon";
import { treeScore, type FlatTree } from "./gbm";
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
  /** A gradient-boosted re-ranker of the linear model's top candidates (live mode, from the local API). */
  ranker?: Ranker | null;
}

/** LightGBM LambdaRank model over `rankerRow` features, trained by `lockout copilot-train`. */
export interface Ranker {
  top: number;
  trees: FlatTree[];
}

export const STEP_KEYS = ["ban-us", "ban-them", "pick-us", "pick-them"] as const;

/** The re-ranker's features for one candidate; the Python trainer reads the same layout from the export. */
export function rankerRow(x: number[], extra: number[], lin: number, linRank: number, key: string, step: number, game: number): number[] {
  return [...x, lin, linRank, STEP_KEYS.indexOf(key as (typeof STEP_KEYS)[number]), step, game, ...extra];
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
  "actingPicks", // share of the acting team's last games where it picked it
  "actingBans", // share of the acting team's last games where it banned it
  "otherPicks", // share of the other team's last games where it picked it
  "other", // picks: max share of a rival's remaining comfort (deny); bans: of the acting team's own comfort
  "fragile", // 1 - pool left, for the player it matters most to
  "winEdge", // shrunk league win rate - 0.5
  "flex", // open players who have it in their pool / 5
  "slotMeta", // sum over open roles of P(role is taken at this pick slot) x league share in that role
  "slotPool", // sum over open players of P(their role at this pick slot) x share of their remaining comfort
  "seriesBansActing", // bans are not locked in Fearless: times the acting team banned it earlier in this series / game
  "seriesBansOther", // times the other team banned it earlier in this series / game
] as const;

/**
 * Softmax ranking weights per step type, learned with `npm run train:copilot` on 488 real series (older games
 * weigh less, half-life 180 days) and checked once on the 80 most recent ones (docs/methodology.md).
 * They are 64 aggregate numbers, not data.
 */
export const LEARNED: Record<string, number[]> = {
  "ban-them": [0.423, 0.463, 1.262, 2.994, 1.066, 0.373, 1.632, 0.78, -0.203, 0.749, 0.413, 0.737, 0.707, 0.42, 1.626, 0.938],
  "ban-us": [0.437, 0.461, 1.33, 3.071, 1.096, 0.32, 1.607, 0.679, -0.199, 0.692, 0.412, 0.778, 0.764, 0.523, 1.616, 0.89],
  "pick-them": [0.21, 0.484, 2.338, 2.072, 1.817, 1.009, 0.782, 0.86, 0.24, 0.996, 0.387, 0.538, 1.579, 0.672, 0.709, 0.556],
  "pick-us": [0.351, 0.456, 2.496, 1.988, 2.043, 0.792, 0.738, 0.847, 0.114, 1.019, 0.446, 0.5, 1.706, 0.641, 0.757, 0.696],
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
  extra: number[][]; // tree-only: main role open (acting, target), presence, players' last-30-day share (relevant, other), 21-day presence, trend
  step: number;
  game: number;
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
  const recentOf = (games: SeriesContext["opponent_recent"]) => ({
    n: Math.max(games.length, 1),
    picks: counts(games.flatMap((g) => g.picks.map((p) => p.champion))),
    bans: counts(games.flatMap((g) => g.bans)),
  });
  const actingRecent = recentOf((ours ? ctx.ours_recent : ctx.opponent_recent) ?? []);
  const otherRecent = recentOf((ours ? ctx.opponent_recent : ctx.ours_recent) ?? []);
  const R = actingRecent.n;
  const recentPicks = actingRecent.picks;
  const recentBans = actingRecent.bans;
  const acting = ours ? usOpen : themOpen;
  const target = ours ? themOpen : usOpen;
  const relevant = o.action === "pick" ? acting : target; // whose pool the move is about
  const other = o.action === "pick" ? target : acting;
  // which role the relevant team takes next: league share of each open role at its next pick slot
  const relevantSide = o.action === "pick" ? o.side : o.side === "blue" ? "red" : "blue";
  const slotN = draftList(game, relevantSide, "pick").filter((c) => !!c).length + 1;
  const slotRaw = ctx.role_by_pick?.[`${relevantSide}-${Math.min(slotN, 5)}`] ?? {};
  const slotTotal = relevant.reduce((acc, s) => acc + (slotRaw[s.player.role] ?? 0), 0);
  const slotP = (role: string) => (slotTotal > 0 ? (slotRaw[role] ?? 0) / slotTotal : relevant.length ? 1 / relevant.length : 0);
  // bans earlier in this series, by side of "us"/"them" (sides swap between games, teams do not)
  const seriesBans = { us: new Map<string, number>(), them: new Map<string, number>() };
  games.slice(0, index).forEach((g) =>
    ORDER.forEach((oo, i) => {
      const c = g.steps[i];
      if (oo.action !== "ban" || !c) return;
      const who = oo.side === g.ourSide ? "us" : "them";
      seriesBans[who].set(c, (seriesBans[who].get(c) ?? 0) + 1);
    }),
  );
  const played = Math.max(index, 1);
  const actingBansSeries = ours ? seriesBans.us : seriesBans.them;
  const otherBansSeries = ours ? seriesBans.them : seriesBans.us;
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
      (otherRecent.picks.get(c) ?? 0) / otherRecent.n,
      f7,
      sb ? 1 - sb.mass : 0,
      m ? (m.wins + 10) / (m.picks + 20) - 0.5 : 0,
      relevant.filter((s) => s.available.some((e) => e.champion === c)).length / 5,
      relevant.reduce((acc, s) => acc + slotP(s.player.role) * (roleDist.get(s.player.role)?.get(c) ?? 0), 0),
      relevant.reduce((acc, s) => acc + slotP(s.player.role) * share(s, c), 0),
      (actingBansSeries.get(c) ?? 0) / played,
      (otherBansSeries.get(c) ?? 0) / played,
    ]);
    why.push({ sb, sr, rival, games });
  }
  const actingRoles = new Set<string>(acting.map((s) => s.player.role));
  const targetRoles = new Set<string>(target.map((s) => s.player.role));
  // what the relevant players have actually been playing this month (any champion, not only their top 8)
  const recentShare = (s: RoleState, c: string) => {
    const r = s.player.recent ?? {};
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    return total ? (r[c] ?? 0) / total : 0;
  };
  const extra = champions.map((c) => {
    const m = meta?.get(c);
    return [
      m && actingRoles.has(m.role) ? 1 : 0,
      m && targetRoles.has(m.role) ? 1 : 0,
      m?.presence ?? 0,
      relevant.reduce((acc, s) => Math.max(acc, recentShare(s, c)), 0),
      other.reduce((acc, s) => Math.max(acc, recentShare(s, c)), 0),
      m?.presence_recent ?? 0,
      (m?.presence_recent ?? 0) - (m?.presence ?? 0),
    ];
  });
  opts.trace?.({ key, champions, X, extra, step, game: index + 1 });

  const scores = X.map((x) => x.reduce((acc, v, i) => acc + v * (w[i] ?? 0), 0));
  let order = scores.map((_, i) => i).sort((a, b) => (scores[b] as number) - (scores[a] as number) || (champions[a] as string).localeCompare(champions[b] as string));
  if (opts.ranker && opts.ranker.trees.length) {
    const head = order.slice(0, opts.ranker.top);
    const rs = new Map(head.map((i, rank) => [i, treeScore((opts.ranker as Ranker).trees, rankerRow(X[i] as number[], extra[i] as number[], scores[i] as number, rank, key, step, index + 1))]));
    order = [...head.sort((a, b) => (rs.get(b) as number) - (rs.get(a) as number)), ...order.slice(opts.ranker.top)];
  }
  const comp = ours && o.action === "pick" ? composition(ourPicks, opts.info ?? (() => undefined)) : null;
  const suggestions = order.slice(0, k).map((i) => explain(champions[i] as string, X[i] as number[], w, why[i] as (typeof why)[number], scores[i] as number));

  function explain(c: string, x: number[], wt: number[], y: (typeof why)[number], score: number): Suggestion {
    const m = meta?.get(c);
    const contrib = x.map((v, i) => ({ i, v: v * (wt[i] ?? 0) })).filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
    const bits: string[] = [];
    const tags: Suggestion["tags"] = [];
    const theirs = o.action === "pick" ? !ours : ours; // the relevant players belong to the opponent
    const player = y.sb ?? y.sr;
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
      else if (i === 5) bits.push(`${ours ? "we" : "they"} picked it in ${recentPicks.get(c)} of the last ${R}`);
      else if (i === 6) bits.push(`${ours ? "we" : "they"} banned it ${recentBans.get(c)}/${R} recently`);
      else if (i === 7) bits.push(`${ours ? "they" : "we"} picked it in ${otherRecent.picks.get(c)} of the last ${otherRecent.n}`);
      else if (i === 8 && y.rival && o.action === "pick")
        bits.push((x[8] ?? 0) >= 0.9 ? `takes ${y.rival.player.name}'s last comfort pick` : `takes ${pct(x[8] ?? 0)} of what ${y.rival.player.name} has left`);
      else if (i === 9 && y.sb) bits.push(`${y.sb.player.name}'s pool is down to ${pct(y.sb.mass)}`);
      else if (i === 10 && m) bits.push(`${pct((m.wins + 10) / (m.picks + 20))} league win rate`);
      else if (i === 11 && (x[11] ?? 0) >= 0.4) bits.push(`flex: ${Math.round((x[11] ?? 0) * 5)} players play it`);
      else if ((i === 12 || i === 13) && player) bits.push(`${ROLE_WORD[player.player.role]} usually picks around now`);
      else if (i === 14) bits.push(`${ours ? "we" : "they"} banned it in ${actingBansSeries.get(c)} earlier game${(actingBansSeries.get(c) ?? 0) > 1 ? "s" : ""} of this series`);
      else if (i === 15) bits.push(`${ours ? "they" : "we"} banned it in ${otherBansSeries.get(c)} earlier game${(otherBansSeries.get(c) ?? 0) > 1 ? "s" : ""} of this series`);
    }
    if ((x[0] ?? 0) > 0) {
      if (o.action === "pick") tags.push("comfort");
      else if (y.sb && y.sb.status !== "ok") tags.push("fragile");
    }
    if (o.action === "pick" && ours && (x[8] ?? 0) > 0.05) tags.push("deny");
    if ((x[5] ?? 0) > 0 || (x[6] ?? 0) > 0) tags.push("habit");
    if (ours && o.action === "pick" && (otherRecent.bans.get(c) ?? 0) > 0) tags.push("ban-risk");
    const fit = comp ? fills(comp, opts.info?.(c), c) : null;
    if (fit) {
      tags.push("comp");
      if (bits.length < 2) bits.push(fit);
    }
    const lead = contrib[0]?.i;
    return {
      champion: c,
      score,
      title: o.action === "ban" ? (ours ? `Ban ${c}` : `They may ban ${c}`) : ours ? `Pick ${c}` : `Likely ${c}`,
      reason: bits.join(" · ") || "league pattern",
      evidence:
        (lead === 0 || lead === 1 || lead === 9 || lead === 13) && y.sb ? `n = ${y.games} games by ${y.sb.player.name}` : m ? `n = ${m.games} league games` : `n = ${R} games`,
      player: player?.player.name,
      role: player?.player.role,
      tags,
    };
  }

  return { step, side: o.side, action: o.action, ours, team: ours ? ctx.ours.name : ctx.opponent.name, suggestions };
}

export interface CallRate {
  hits: number; // real choice in the top 3
  hits10: number; // real choice in the top-10 shortlist
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
  const out: CallRate = { hits: 0, hits10: 0, total: 0, steps: Array<boolean | null>(ORDER.length).fill(null), ours: { hits: 0, total: 0 }, theirs: { hits: 0, total: 0 } };
  for (let gi = 0; gi <= index && gi < games.length; gi++) {
    const g = games[gi] as GameDraft;
    for (let s = 0; s < ORDER.length; s++) {
      const actual = g.steps[s];
      if (!actual) continue;
      const before: GameDraft = { ...g, steps: g.steps.map((c, i) => (i < s ? c : null)), winner: null };
      // a missed ban earlier in the game leaves a hole; fill it with a placeholder so the step lines up
      before.steps = before.steps.map((c, i) => (i < s && c === null ? "—" : c));
      const advice = advise(ctx, [...games.slice(0, gi), before], gi, { ...opts, k: 10 });
      if (!advice || advice.step !== s) continue;
      const hit = advice.suggestions.slice(0, 3).some((x) => x.champion === actual);
      if (advice.suggestions.some((x) => x.champion === actual)) out.hits10++;
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
