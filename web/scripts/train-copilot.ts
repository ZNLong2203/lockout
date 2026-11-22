// Learn the co-pilot's ranking weights: a softmax (conditional logit) over the candidate champions of each step,
// one weight vector per step type. Holds out the 80 most recent real series and trains on every older one.
//
//   uv run lockout serve              # in another terminal
//   cd web && npm run train:copilot   # prints the weights to paste into LEARNED in src/lib/copilot.ts
//
// Downloaded drafts are cached under ../private/cache/eval (gitignored). Prints aggregates and weights only.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ChampionStats, SeriesDraft, SeriesSummary } from "../src/api/types";
import { FEATURES, LEARNED, advise, type Trace } from "../src/lib/copilot";
import type { GameDraft } from "../src/lib/draft";

const API = process.env.API ?? "http://127.0.0.1:8000";
const CACHE = process.env.EVAL_DIR ?? new URL("../../private/cache/eval/", import.meta.url).pathname; // EVAL_DIR: e.g. the public cache
const get = async <T>(path: string): Promise<T> => (await fetch(API + path)).json() as Promise<T>;

/** Every finished multi-game series, newest first (cached). */
async function loadAll(): Promise<SeriesDraft[]> {
  mkdirSync(CACHE, { recursive: true });
  const file = `${CACHE}series_all.json`;
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as SeriesDraft[];
  const list = (await get<SeriesSummary[]>("/api/series?limit=1000")).filter((s) => s.games >= 2);
  const out: SeriesDraft[] = [];
  for (const s of list) out.push(await get<SeriesDraft>(`/api/series/${encodeURIComponent(s.series_id)}/draft`));
  writeFileSync(file, JSON.stringify(out));
  return out;
}

interface Example {
  X: number[][];
  y: number; // index of the real choice among the candidates
  w: number; // recency weight: the meta drifts, so recent series count more
}

/** Walk every step of every series; `visit` gets the candidates' features and the real choice. */
function walk(drafts: SeriesDraft[], weights: Record<string, number[]> | undefined, visit: (t: Trace, actual: string, top: string[], d: SeriesDraft) => void) {
  for (const d of drafts) {
    const meta = new Map<string, ChampionStats>(d.meta.map((c) => [c.champion, c]));
    const ours = d.series.teams[0]?.team_id;
    const games: GameDraft[] = d.games.map((g, i) => ({ number: i + 1, ourSide: g.blue_team_id === ours ? "blue" : "red", steps: g.steps, winner: null }));
    const ctx = { ...d.context, games };
    games.forEach((g, gi) => {
      g.steps.forEach((actual, st) => {
        if (!actual) return;
        const before: GameDraft = { ...g, steps: g.steps.map((c, i) => (i < st ? (c ?? "—") : null)) };
        let trace: Trace | null = null;
        const advice = advise(ctx, [...games.slice(0, gi), before], gi, { meta, weights, trace: (t) => (trace = t) });
        if (advice && trace) visit(trace, actual, advice.suggestions.map((s) => s.champion), d);
      });
    });
  }
}

function train(examples: Example[], dims: number, l2 = 0.01, iters = Number(process.env.ITERS ?? 300)): number[] {
  const w = new Array<number>(dims).fill(0);
  const m = new Array<number>(dims).fill(0);
  const v = new Array<number>(dims).fill(0);
  const lr = 0.05;
  for (let it = 1; it <= iters; it++) {
    const g = w.map((wi) => l2 * wi);
    const W = examples.reduce((a, ex) => a + ex.w, 0);
    for (const ex of examples) {
      const s = ex.X.map((x) => x.reduce((a, xi, i) => a + xi * (w[i] as number), 0));
      const mx = Math.max(...s);
      const e = s.map((z) => Math.exp(z - mx));
      const sum = e.reduce((a, b) => a + b, 0);
      ex.X.forEach((x, j) => {
        const p = (e[j] as number) / sum - (j === ex.y ? 1 : 0);
        x.forEach((xi, i) => (g[i] = (g[i] as number) + (ex.w * p * xi) / W));
      });
    }
    g.forEach((gi, i) => {
      m[i] = 0.9 * (m[i] as number) + 0.1 * gi;
      v[i] = 0.999 * (v[i] as number) + 0.001 * gi * gi;
      const mh = (m[i] as number) / (1 - 0.9 ** it);
      const vh = (v[i] as number) / (1 - 0.999 ** it);
      w[i] = (w[i] as number) - (lr * mh) / (Math.sqrt(vh) + 1e-8);
    });
  }
  return w.map((x) => Math.round(x * 1000) / 1000);
}

function score(drafts: SeriesDraft[], weights?: Record<string, number[]>) {
  const by: Record<string, [number, number]> = {};
  let hits = 0;
  let total = 0;
  walk(drafts, weights, (t, actual, top) => {
    by[t.key] ??= [0, 0];
    (by[t.key] as [number, number])[1]++;
    total++;
    if (top.includes(actual)) {
      (by[t.key] as [number, number])[0]++;
      hits++;
    }
  });
  const pct = (a: number, b: number) => `${((100 * a) / Math.max(b, 1)).toFixed(1)}%`;
  return `${pct(hits, total)} (${hits}/${total}) | ` + Object.entries(by).sort().map(([k, [h, n]]) => `${k} ${pct(h, n)}`).join(" · ");
}

const all = await loadAll();
const HOLD = Number(process.env.HOLD ?? 80);
const heldOut = all.slice(0, HOLD); // the most recent series
const tuneSet = all.slice(HOLD);
const examples: Record<string, Example[]> = {};
let missing = 0;
const HALF_LIFE = Number(process.env.HALF_LIFE ?? 180); // days
const newest = Date.parse(tuneSet[0]?.series.date ?? "2026-01-01");
walk(tuneSet, undefined, (t, actual, _top, d) => {
  const y = t.champions.indexOf(actual);
  if (y < 0) return void missing++;
  const age = (newest - Date.parse(d.series.date)) / 86_400_000;
  (examples[t.key] ??= []).push({ X: t.X, y, w: 0.5 ** (age / HALF_LIFE) });
});
const learned: Record<string, number[]> = {};
for (const [key, ex] of Object.entries(examples)) learned[key] = train(ex, FEATURES.length);
console.log(`training steps: ${Object.values(examples).reduce((a, e) => a + e.length, 0)} (real choice not a candidate: ${missing})`);
console.log(`features: ${FEATURES.join(", ")}`);
console.log("LEARNED =", JSON.stringify(learned, null, 1));
const span = (ds: SeriesDraft[]) => `${ds[ds.length - 1]?.series.date} .. ${ds[0]?.series.date}`;
console.log(`train: ${tuneSet.length} series (${span(tuneSet)}); held out: ${heldOut.length} series (${span(heldOut)})`);
console.log(`held-out set current ${score(heldOut, LEARNED)}`);
console.log(`held-out set learned ${score(heldOut, learned)}`);
