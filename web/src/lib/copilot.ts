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
  weights?: Partial<typeof WEIGHTS>;
}

const ROLE_WORD: Record<string, string> = { top: "top", jungle: "jungler", mid: "mid", adc: "ADC", support: "support", unknown: "player" };

function counts(list: string[]): Map<string, number> {
  const m = new Map<string, number>();
  list.forEach((c) => m.set(c, (m.get(c) ?? 0) + 1));
  return m;
}

function best(cands: Suggestion[], k: number): Suggestion[] {
  const byChamp = new Map<string, Suggestion>();
  for (const c of cands) {
    const cur = byChamp.get(c.champion);
    if (!cur || c.score > cur.score) byChamp.set(c.champion, c);
  }
  return [...byChamp.values()].sort((a, b) => b.score - a.score || a.champion.localeCompare(b.champion)).slice(0, k);
}

const open = (states: RoleState[], assigned: Map<string, string>) => states.filter((s) => !assigned.has(s.player.player_id));

/** Blend weights, tuned on real series with `callRate` (see docs/methodology.md). */
export const WEIGHTS = {
  poolPick: 0.2, // a player's own pool vs the league's picks in that role
  banMeta: 1.3, // league ban rate
  banThreat: 0.45, // share of an open player's remaining comfort
  banHabit: 0.35, // the team's own recent bans
  deny: 0.15, // prescriptive extras for our picks
  comp: 0.05,
  sumPick: 0, // 1 = a champion's chance sums over every open player (flex picks), 0 = best single player
};

interface MetaIndex {
  rolePick: Map<string, Map<string, number>>; // role -> champion -> share of that role's picks
  banRate: Map<string, number>;
  presence: Map<string, number>;
}

const metaCache = new WeakMap<object, MetaIndex>();

function indexMeta(meta: Meta | undefined): MetaIndex {
  const empty: MetaIndex = { rolePick: new Map(), banRate: new Map(), presence: new Map() };
  if (!meta) return empty;
  const cached = metaCache.get(meta);
  if (cached) return cached;
  const out = empty;
  const totals = new Map<string, number>();
  meta.forEach((c) => {
    out.banRate.set(c.champion, c.games ? c.bans / c.games : 0);
    out.presence.set(c.champion, c.presence);
    Object.entries(c.roles).forEach(([role, share]) => {
      const n = c.picks * share;
      totals.set(role, (totals.get(role) ?? 0) + n);
      if (!out.rolePick.has(role)) out.rolePick.set(role, new Map());
      out.rolePick.get(role)?.set(c.champion, n);
    });
  });
  out.rolePick.forEach((m, role) => m.forEach((n, c) => m.set(c, n / (totals.get(role) || 1))));
  metaCache.set(meta, out);
  return out;
}

/** Normalise a champion -> weight map over the champions still available. */
function norm(m: Map<string, number>, unavailable: Set<string>): Map<string, number> {
  let total = 0;
  m.forEach((v, c) => !unavailable.has(c) && (total += v));
  const out = new Map<string, number>();
  if (total > 0) m.forEach((v, c) => !unavailable.has(c) && out.set(c, v / total));
  return out;
}

/** Where a player's next pick comes from: their remaining pool blended with the league's picks in their role. */
function pickDist(s: RoleState, mi: MetaIndex, unavailable: Set<string>, w: number): Map<string, { p: number; pool: number; league: number }> {
  const pool = new Map(s.available.map((e) => [e.champion, s.mass > 0 ? e.share / s.mass : 0]));
  const league = norm(mi.rolePick.get(s.player.role) ?? new Map(), unavailable);
  const wp = league.size ? (s.available.length ? w : 0) : 1;
  const out = new Map<string, { p: number; pool: number; league: number }>();
  new Set([...pool.keys(), ...league.keys()]).forEach((c) => {
    const a = pool.get(c) ?? 0;
    const b = league.get(c) ?? 0;
    out.set(c, { p: wp * a + (1 - wp) * b, pool: a, league: b });
  });
  return out;
}

const leagueLine = (c: string, meta: Meta | undefined, role: string) => {
  const m = meta?.get(c);
  if (!m) return "";
  return `league: ${pct(m.roles[role] ? (m.picks * (m.roles[role] ?? 0)) / Math.max(m.games, 1) : m.picks / Math.max(m.games, 1))} of ${role} games`;
};

/** Advice for the next empty step of `games[index]`; null when the draft is complete. */
export function advise(ctx: SeriesContext, games: GameDraft[], index: number, opts: Options = {}): StepAdvice | null {
  const game = games[index];
  if (!game) return null;
  const step = nextStep(game);
  if (step < 0) return null;
  const o = ORDER[step] as (typeof ORDER)[number];
  const k = opts.k ?? 3;
  const W = { ...WEIGHTS, ...opts.weights };
  const mi = indexMeta(opts.meta);
  const usSide = sideOf(game, "us");
  const themSide = sideOf(game, "them");
  const ours = o.side === usSide;
  const roleOf = (c: string) => opts.meta?.get(c)?.role;
  const unavailable = new Set([...lockedBefore(games, index), ...usedIn(game)]);
  const ourPicks = draftList(game, usSide, "pick").filter((c): c is string => !!c);
  const theirPicks = draftList(game, themSide, "pick").filter((c): c is string => !!c);
  const usOpen = open(analyseTeam(ctx.ours, unavailable), assignPicks(ctx.ours, ourPicks, roleOf));
  const themOpen = open(analyseTeam(ctx.opponent, unavailable), assignPicks(ctx.opponent, theirPicks, roleOf));
  const recent = ctx.opponent_recent;
  const R = Math.max(recent.length, 1);
  const recentPicks = counts(recent.flatMap((g) => g.picks.map((p) => p.champion)));
  const recentBans = counts(recent.flatMap((g) => g.bans));
  const cands: Suggestion[] = [];
  const acting = ours ? usOpen : themOpen; // whose picks we model
  const target = ours ? themOpen : usOpen; // whose comfort a ban hits

  if (o.action === "ban") {
    // threat: the most a ban takes from any open player of the other team
    const threat = new Map<string, { bite: number; s: RoleState; games: number }>();
    for (const s of target) {
      if (s.mass <= 0) continue;
      for (const e of s.available) {
        const bite = (e.share / s.mass) * (1.5 - s.mass);
        if (bite > (threat.get(e.champion)?.bite ?? 0)) threat.set(e.champion, { bite, s, games: e.games });
      }
    }
    const banMeta = norm(mi.banRate, unavailable);
    // the opponent's own habits only inform predictions of the opponent
    const habit = ours ? new Map<string, number>() : norm(recentBans, unavailable);
    const names = new Set([...threat.keys(), ...[...banMeta.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([c]) => c), ...habit.keys()]);
    for (const c of names) {
      if (unavailable.has(c)) continue;
      const t = threat.get(c);
      const lm = banMeta.get(c) ?? 0;
      const h = habit.get(c) ?? 0;
      const parts = [W.banThreat * (t?.bite ?? 0), W.banMeta * lm * 4, W.banHabit * h * 3];
      const score = parts[0]! + parts[1]! + parts[2]!;
      const lead = parts.indexOf(Math.max(...parts));
      const m = opts.meta?.get(c);
      const reasonThreat = t ? `${pct(t.bite / (1.5 - t.s.mass))} of what ${ours ? "their" : "our"} ${ROLE_WORD[t.s.player.role]} ${t.s.player.name} has left` : "";
      const reasonMeta = m ? `banned in ${pct(m.bans / Math.max(m.games, 1))} of league games` : "";
      const reasonHabit = recentBans.get(c) ? `they banned it ${recentBans.get(c)}/${R} recently` : "";
      const reasons = (lead === 0 ? [reasonThreat, reasonMeta, reasonHabit] : lead === 1 ? [reasonMeta, reasonThreat, reasonHabit] : [reasonHabit, reasonThreat, reasonMeta]).filter(Boolean);
      const tags: Suggestion["tags"] = [];
      if (t && t.s.status !== "ok") tags.push("fragile");
      if (h > 0) tags.push("habit");
      cands.push({
        champion: c,
        score,
        title: ours ? `Ban ${c}` : `They may ban ${c}`,
        reason: reasons.slice(0, 2).join(" · "),
        evidence: lead === 0 && t ? `n = ${t.games} games by ${t.s.player.name}` : m ? `n = ${m.games} league games` : `n = ${R} games`,
        player: t?.s.player.name,
        role: t?.s.player.role,
        tags,
      });
    }
  } else {
    const comp = ours ? composition(ourPicks, opts.info ?? (() => undefined)) : null;
    for (const s of acting) {
      const dist = pickDist(s, mi, unavailable, W.poolPick);
      const top = [...dist.entries()].sort((a, b) => b[1].p - a[1].p).slice(0, 8);
      for (const [c, d] of top) {
        const tags: Suggestion["tags"] = [];
        const bits: string[] = [];
        let score = d.p;
        const entry = s.available.find((e) => e.champion === c);
        if (d.pool > 0) {
          tags.push("comfort");
          bits.push(ours ? `${pct(d.pool)} of ${s.player.name}'s comfort left` : `${s.player.name}'s ${pct(d.pool)} of what's left`);
        } else {
          bits.push(leagueLine(c, opts.meta, s.player.role) || "league pick");
        }
        if (ours) {
          const rivals = target
            .map((t) => ({ t, bite: t.mass > 0 ? (t.available.find((e) => e.champion === c)?.share ?? 0) / t.mass : 0 }))
            .sort((a, b) => b.bite - a.bite);
          const rival = rivals[0];
          if (rival && rival.bite > 0.05) {
            tags.push("deny");
            bits.push(rival.bite >= 0.9 ? `takes ${rival.t.player.name}'s last comfort pick` : `takes ${pct(rival.bite)} of what ${rival.t.player.name} has left`);
            score += W.deny * rival.bite;
          }
          const fit = comp ? fills(comp, opts.info?.(c), c) : null;
          if (fit) {
            tags.push("comp");
            bits.push(fit);
            score += W.comp;
          }
          if (recentBans.get(c)) tags.push("ban-risk");
        } else if (recentPicks.get(c)) {
          tags.push("habit");
          bits.push(`${recentPicks.get(c)} of their last ${R}`);
          score += 0.03 * (recentPicks.get(c) ?? 0);
        }
        cands.push({
          champion: c,
          score,
          title: ours ? `Pick ${c}` : `Likely ${c}`,
          reason: bits.slice(0, 2).join(" · "),
          evidence: entry ? `n = ${entry.games} games by ${s.player.name}` : `n = ${opts.meta?.get(c)?.picks ?? 0} league picks`,
          player: s.player.name,
          role: s.player.role,
          tags,
        });
      }
    }
  }
  return {
    step,
    side: o.side,
    action: o.action,
    ours,
    team: ours ? ctx.ours.name : ctx.opponent.name,
    suggestions: best(o.action === "pick" && W.sumPick ? sumFlex(cands) : cands, k).filter((c) => !unavailable.has(c.champion)),
  };
}

/** A champion several open players could take is likelier: add the extra players' chances to its best entry. */
function sumFlex(cands: Suggestion[]): Suggestion[] {
  const by = new Map<string, Suggestion[]>();
  cands.forEach((c) => by.set(c.champion, [...(by.get(c.champion) ?? []), c]));
  return [...by.values()].map((list) => {
    const sorted = [...list].sort((a, b) => b.score - a.score);
    const top = sorted[0] as Suggestion;
    return { ...top, score: sorted.reduce((s, c) => s + c.score, 0) };
  });
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
