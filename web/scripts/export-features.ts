// Export the co-pilot's candidate features for every step of every finished series, for training ranking models
// in Python (LightGBM / XGBoost). Written to ../private/cache/eval/ (gitignored): it is derived from licensed data.
//
//   cd web && npm run export:features      (needs the series cache written by train:copilot or eval:copilot)
import { createWriteStream, readFileSync } from "node:fs";
import type { ChampionStats, SeriesDraft } from "../src/api/types";
import { LEARNED, advise, rankerRow, type Trace } from "../src/lib/copilot";
import type { GameDraft } from "../src/lib/draft";

const CACHE = process.env.EVAL_DIR ?? new URL("../../private/cache/eval/", import.meta.url).pathname; // EVAL_DIR: e.g. the public cache
const HOLD = Number(process.env.HOLD ?? 80);
const TOP = Number(process.env.TOP ?? 60); // candidates kept per step: the linear model's top N (the trees re-rank them)
const all = JSON.parse(readFileSync(`${CACHE}series_all.json`, "utf8")) as SeriesDraft[];
const out = createWriteStream(`${CACHE}copilot_features.jsonl`);
let steps = 0;
let inTop = 0;
all.forEach((d, si) => {
  const split = si < HOLD ? "test" : "train";
  const meta = new Map<string, ChampionStats>(d.meta.map((c) => [c.champion, c]));
  const ours = d.series.teams[0]?.team_id;
  const games: GameDraft[] = d.games.map((g, i) => ({ number: i + 1, ourSide: g.blue_team_id === ours ? "blue" : "red", steps: g.steps, winner: null }));
  const ctx = { ...d.context, games };
  games.forEach((g, gi) => {
    g.steps.forEach((actual, st) => {
      if (!actual) return;
      const before: GameDraft = { ...g, steps: g.steps.map((c, i) => (i < st ? (c ?? "—") : null)) };
      let trace: Trace | null = null;
      advise(ctx, [...games.slice(0, gi), before], gi, { meta, trace: (t) => (trace = t), k: 0 });
      if (!trace) return;
      const t = trace as Trace;
      const w = LEARNED[t.key] as number[];
      const lin = t.X.map((x) => x.reduce((a, v, i) => a + v * (w[i] ?? 0), 0));
      const order = lin.map((_, i) => i).sort((a, b) => (lin[b] as number) - (lin[a] as number));
      const keep = order.slice(0, TOP);
      // never add the real choice when the linear model missed it: its rank alone would give the answer away
      const y = t.champions.indexOf(actual);
      if (y >= 0 && keep.includes(y)) inTop++;
      steps++;
      const rows = keep.map((i) =>
        rankerRow(t.X[i] as number[], t.extra[i] as number[], lin[i] as number, order.indexOf(i), t.key, t.step, t.game).map((v) => Math.round(v * 1e4) / 1e4),
      );
      out.write(JSON.stringify({ split, s: si, key: t.key, step: st, game: gi + 1, y: keep.indexOf(y), rows }) + "\n");
    });
  });
});
out.end(() => console.log(`steps ${steps}; real choice within the linear top ${TOP}: ${((100 * inTop) / steps).toFixed(1)}%`));
