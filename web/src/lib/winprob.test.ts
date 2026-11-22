import { describe, expect, it } from "vitest";
import type { WinModel } from "../api/types";
import { DEMO_SERIES, DEMO_WIN_MODEL } from "../demo/series";
import { emptyDraft } from "./draft";
import { champEdge, winChance, winTimeline } from "./winprob";

const ctx = { ...DEMO_SERIES, games: [] };

describe("live win chance", () => {
  it("starts from team strength and side, then reacts to picks", () => {
    const model: WinModel = { ...DEMO_WIN_MODEL, ours_elo: 1600, opponent_elo: 1500 };
    const g = emptyDraft(1, "blue");
    const p0 = winChance(model, ctx, [g], 0);
    expect(p0).toBeGreaterThan(0.5);
    expect(winChance({ ...model, ours_elo: 1400 }, ctx, [g], 0)).toBeLessThan(p0);
    // the same matchup seen from red side flips the side advantage only
    expect(winChance(model, ctx, [emptyDraft(1, "red")], 0)).toBeLessThan(p0);
    // our top's comfort pick raises our chance
    expect(winChance(model, ctx, [g], 0, undefined, { side: "blue", champion: "Gnar" })).toBeGreaterThan(p0);
  });

  it("gives one value per drafted step", () => {
    const games = DEMO_SERIES.games;
    expect(winTimeline(DEMO_WIN_MODEL, ctx, games, 1)).toHaveLength(21);
  });

  it("shrinks champion win rates towards even", () => {
    expect(champEdge(0, 0)).toBe(0);
    expect(champEdge(8, 10)).toBeLessThan(0.3);
  });
});

describe("static Elo history", () => {
  it("takes the last rating before the time and pulls it back after a long break", async () => {
    const { eloBefore } = await import("../api/static");
    const h: [string, number][] = [["2026-01-01T00:00:00", 1600], ["2026-02-01T00:00:00", 1640]];
    expect(eloBefore(h, new Date("2026-01-15T00:00:00"))).toBe(1600);
    expect(eloBefore(h, new Date("2026-02-10T00:00:00"))).toBe(1640);
    expect(eloBefore(h, new Date("2026-06-01T00:00:00"))).toBe(1570); // halfway back to 1500 after 30+ days
    expect(eloBefore([], new Date())).toBe(1500);
  });
});
