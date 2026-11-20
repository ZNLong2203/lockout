import { describe, expect, it } from "vitest";
import { DEMO_SERIES } from "../demo/series";
import { composition, fills } from "./comp";
import { advise, callRate } from "./copilot";
import type { ChampInfo } from "./ddragon";
import { assignPicks, emptyDraft, type GameDraft } from "./draft";
import { budgetAlerts, forecastSeries, rng } from "./sim";

const ctx = { ...DEMO_SERIES, games: [] };
const INFO: Record<string, ChampInfo> = {
  Jhin: { tags: ["Marksman"], attack: 10, defense: 2, magic: 6, range: 550 },
  Rumble: { tags: ["Fighter", "Mage"], attack: 3, defense: 6, magic: 8, range: 125 },
  Wukong: { tags: ["Fighter", "Tank"], attack: 8, defense: 5, magic: 2, range: 175 },
  Lucian: { tags: ["Marksman"], attack: 8, defense: 5, magic: 3, range: 500 },
  Renekton: { tags: ["Fighter", "Tank"], attack: 8, defense: 5, magic: 2, range: 125 },
  Ryze: { tags: ["Mage"], attack: 2, defense: 2, magic: 10, range: 550 },
};
const info = (c: string) => INFO[c];

describe("composition", () => {
  it("splits damage and counts frontline, engage and range", () => {
    const c = composition(["Jhin", "Wukong", "Lucian", "Renekton"], info);
    expect(c.physical).toBeGreaterThan(0.7);
    expect(c.frontline).toBe(2);
    expect(c.engage).toBe(1); // Wukong
    expect(c.ranged).toBe(2);
    expect(c.warnings[0]).toMatch(/physical/);
    expect(fills(c, INFO.Ryze, "Ryze")).toBe("adds magic damage");
  });
});

describe("pick assignment", () => {
  it("gives each pick to the player whose pool holds it most", () => {
    const a = assignPicks(ctx.opponent, ["Rumble", "Jhin"]);
    expect(a.get("bravo-top")).toBe("Rumble");
    expect(a.get("bravo-adc")).toBe("Jhin");
  });
  it("falls back to the champion's usual role", () => {
    const a = assignPicks(ctx.opponent, ["Shen"], (c) => (c === "Shen" ? "support" : undefined));
    expect(a.get("bravo-support")).toBe("Shen");
  });
});

describe("co-pilot", () => {
  it("opens with three bans aimed at the opponent's fragile comfort picks", () => {
    const advice = advise(ctx, [emptyDraft(1, "blue")], 0);
    expect(advice).toMatchObject({ step: 0, action: "ban", ours: true });
    expect(advice?.suggestions).toHaveLength(3);
    for (const s of advice?.suggestions ?? []) {
      expect(s.title).toMatch(/^Ban /);
      expect(s.evidence).toMatch(/^n = \d+/);
    }
  });

  it("predicts the opponent on their turn and never repeats an unavailable champion", () => {
    const g: GameDraft = emptyDraft(1, "blue");
    g.steps[0] = "Rumble";
    const advice = advise(ctx, [g], 0);
    expect(advice).toMatchObject({ step: 1, ours: false, action: "ban" });
    expect(advice?.suggestions.map((s) => s.champion)).not.toContain("Rumble");
  });

  it("suggests picks for our open roles only", () => {
    const g: GameDraft = emptyDraft(1, "blue");
    for (let i = 0; i < 6; i++) g.steps[i] = `Ban${i}`;
    const advice = advise(ctx, [g], 0, { info });
    expect(advice?.action).toBe("pick");
    expect(advice?.suggestions.every((s) => s.title.startsWith("Pick "))).toBe(true);
  });

  it("scores a finished series only on what was known before each step", () => {
    const r = callRate(ctx, DEMO_SERIES.games.slice(0, 2), 1);
    expect(r.total).toBe(40);
    expect(r.hits).toBeGreaterThan(0);
    expect(r.ours.total + r.theirs.total).toBe(40);
    expect(r.steps.filter((x) => x !== null)).toHaveLength(20);
  });
});

describe("series forecast", () => {
  it("is deterministic and only shrinks pools game after game", () => {
    const run = () =>
      forecastSeries({ ours: ctx.ours, opponent: ctx.opponent, locked: new Set(), current: new Set(), filled: new Set(), fromGame: 1, lastGame: 5, nSims: 120 });
    const a = run();
    expect(a).toEqual(run());
    for (const p of a.players) {
      expect(p.mass).toHaveLength(5);
      for (let i = 1; i < p.mass.length; i++) expect(p.mass[i]).toBeLessThanOrEqual((p.mass[i - 1] as number) + 1e-9);
    }
    expect(budgetAlerts(a, 0.2).length).toBeGreaterThan(0);
  });
  it("draws uniform numbers in [0, 1)", () => {
    const r = rng(1);
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
  });
});

describe("budget", () => {
  it("is exact for played games and forecasts the rest, with a what-if delta", async () => {
    const { buildBudget } = await import("./budget");
    const games = DEMO_SERIES.games;
    const b = buildBudget({ ...DEMO_SERIES }, games, 2, undefined, "Ryze", 80);
    const row = b.rows.find((r) => r.name === "Sable") as (typeof b.rows)[number];
    expect(row.cells.map((c) => c.kind)).toEqual(["past", "past", "now", "future", "future"]);
    expect(row.cells[0]?.mass).toBeGreaterThan(row.cells[2]?.mass as number);
    expect(b.whatIf).toBe("Ryze");
    // Ryze is Sable's champion: taking it now leaves Sable less for later games
    expect(row.cells[3]?.delta).toBeLessThan(0);
  });
});
