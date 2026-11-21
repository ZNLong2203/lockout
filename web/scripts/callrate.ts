// How often the co-pilot's top three contains the real choice, over finished real series, with no look-ahead.
//
//   uv run lockout serve            # in another terminal
//   cd web && npm run eval:copilot  # scores the 80 most recent series: the held-out set of `npm run train:copilot`
//
// Every series is replayed step by step with `advise` and the context the API builds from data *before* game 1
// (pools, lineups, opponent's recent games, league meta). Prints aggregate rates only. Downloaded drafts are
// cached under ../private/cache/eval (gitignored): they are derived from the licensed data.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { advise } from "../src/lib/copilot";
import { ORDER, type GameDraft } from "../src/lib/draft";
import type { ChampionStats, CopilotRanker, SeriesDraft, SeriesSummary } from "../src/api/types";

const API = process.env.API ?? "http://127.0.0.1:8000";
const HOLD = Number(process.env.HOLD ?? 80);
const CACHE = new URL("../../private/cache/eval/", import.meta.url).pathname;
const get = async <T>(path: string): Promise<T> => (await fetch(API + path)).json() as Promise<T>;

mkdirSync(CACHE, { recursive: true });
const file = `${CACHE}series_all.json`;
let all: SeriesDraft[];
if (existsSync(file)) all = JSON.parse(readFileSync(file, "utf8")) as SeriesDraft[];
else {
  const list = (await get<SeriesSummary[]>("/api/series?limit=1000")).filter((s) => s.games >= 2);
  all = [];
  for (const s of list) all.push(await get<SeriesDraft>(`/api/series/${s.series_id}/draft`));
  writeFileSync(file, JSON.stringify(all));
}
const drafts = all.slice(0, HOLD);

// the local API serves the tree re-ranker once `lockout copilot-train` has run
const rankerRes = await fetch(`${API}/api/draft/copilot-ranker`);
const ranker = rankerRes.ok ? ((await rankerRes.json()) as CopilotRanker) : null;

function run(withRanker: boolean) {
  const kinds: Record<string, [number, number]> = {};
  const hits: Record<number, number> = { 1: 0, 3: 0, 5: 0, 10: 0 };
  let total = 0;
  let baseline = 0;
  for (const d of drafts) {
    const meta = new Map<string, ChampionStats>(d.meta.map((c) => [c.champion, c]));
    const ours = d.series.teams[0]?.team_id;
    const games: GameDraft[] = d.games.map((g, i) => ({ number: i + 1, ourSide: g.blue_team_id === ours ? "blue" : "red", steps: g.steps, winner: null }));
    const ctx = { ...d.context, games };
    games.forEach((g, gi) => {
      g.steps.forEach((actual, st) => {
        if (!actual) return;
        const before: GameDraft = { ...g, steps: g.steps.map((c, i) => (i < st ? (c ?? "—") : null)) };
        const advice = advise(ctx, [...games.slice(0, gi), before], gi, { meta, k: 10, ranker: withRanker ? ranker : null });
        if (!advice) return;
        const top = advice.suggestions.map((s) => s.champion);
        const key = `${advice.ours ? "first team" : "second team"} ${advice.action}`;
        kinds[key] ??= [0, 0];
        (kinds[key] as [number, number])[1]++;
        total++;
        for (const k of [1, 3, 5, 10]) if (top.slice(0, k).includes(actual)) hits[k] = (hits[k] as number) + 1;
        if (top.slice(0, 3).includes(actual)) (kinds[key] as [number, number])[0]++;
        const used = new Set([...games.slice(0, gi).flatMap((x) => ORDER.map((o, i) => (o.action === "pick" ? x.steps[i] : null))), ...before.steps]);
        if (d.meta.filter((c) => !used.has(c.champion)).slice(0, 3).some((c) => c.champion === actual)) baseline++;
      });
    });
  }
  return { kinds, hits, total, baseline };
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(b, 1)).toFixed(1)}%`;
const dates = drafts.map((d) => d.series.date).sort();
const lin = run(false);
console.log(`series ${drafts.length} (${dates[0]} .. ${dates[dates.length - 1]}), steps ${lin.total}`);
console.log(`presence baseline top 3   ${pct(lin.baseline, lin.total)}`);
for (const [name, r] of ranker ? [["linear", lin], ["linear + trees", run(true)]] as const : [["linear", lin]] as const) {
  console.log(`${name.padEnd(16)} top 1 ${pct(r.hits[1] as number, r.total)} · top 3 ${pct(r.hits[3] as number, r.total)} · top 5 ${pct(r.hits[5] as number, r.total)} · top 10 ${pct(r.hits[10] as number, r.total)}`);
  console.log("  top 3 by step: " + Object.entries(r.kinds).sort().map(([k, [h, t]]) => `${k} ${pct(h, t)}`).join(" · "));
}
