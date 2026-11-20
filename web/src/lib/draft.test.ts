import { describe, expect, it } from "vitest";
import { DEMO_SERIES } from "../demo/series";
import { ORDER, analyseTeam, banIdeas, classify, emptyDraft, lockedBefore, nextStep, sideOf, usedIn } from "./draft";

describe("draft order", () => {
  it("has 10 bans and 10 picks in the tournament order", () => {
    expect(ORDER).toHaveLength(20);
    expect(ORDER.filter((o) => o.action === "ban")).toHaveLength(10);
    expect(ORDER.filter((o) => o.action === "pick")).toHaveLength(10);
    expect(ORDER.slice(0, 6).every((o) => o.action === "ban")).toBe(true);
    expect(ORDER.slice(6, 12).every((o) => o.action === "pick")).toBe(true);
  });

  it("gives each side five picks", () => {
    const picks = ORDER.filter((o) => o.action === "pick");
    expect(picks.filter((o) => o.side === "blue")).toHaveLength(5);
    expect(picks.filter((o) => o.side === "red")).toHaveLength(5);
  });
});

describe("a game in progress", () => {
  it("starts empty and fills in order", () => {
    const g = emptyDraft(1, "blue");
    expect(nextStep(g)).toBe(0);
    g.steps[0] = "Rumble";
    expect(nextStep(g)).toBe(1);
    expect(usedIn(g)).toEqual(new Set(["Rumble"]));
    expect(nextStep({ ...g, steps: g.steps.map(() => "x") })).toBe(-1);
  });

  it("knows which side the opponent is on", () => {
    expect(sideOf(emptyDraft(1, "blue"), "us")).toBe("blue");
    expect(sideOf(emptyDraft(1, "blue"), "them")).toBe("red");
    expect(sideOf(emptyDraft(2, "red"), "them")).toBe("blue");
  });
});

describe("Fearless locks", () => {
  const [g1, g2] = DEMO_SERIES.games;

  it("locks only champions that were PICKED in earlier games, never bans", () => {
    const locked = lockedBefore([g1!, g2!, emptyDraft(3, "blue")], 2);
    expect(locked.has("Ezreal")).toBe(true); // picked in game 1
    expect(locked.has("Jarvan IV")).toBe(true); // picked in game 2
    expect(locked.has("Rumble")).toBe(false); // only ever banned
    expect(lockedBefore([g1!, g2!], 0).size).toBe(0);
    expect(lockedBefore([g1!, g2!], 1).has("Jarvan IV")).toBe(false); // game 2 is not "before" game 2
  });
});

describe("pool state", () => {
  it("classifies at the same thresholds as the Python model (35% and 60%)", () => {
    expect(classify(0.34)).toBe("critical");
    expect(classify(0.35)).toBe("thin");
    expect(classify(0.59)).toBe("thin");
    expect(classify(0.6)).toBe("ok");
  });

  it("removes unavailable champions from a pool and sorts the weakest role first", () => {
    const unavailable = new Set(["Kalista", "Ezreal"]); // our two best ADC champions: 0.34 + 0.30
    const states = analyseTeam(DEMO_SERIES.ours, unavailable);
    expect(states[0]?.player.role).toBe("adc");
    expect(states[0]?.mass).toBeCloseTo(0.36, 5);
    expect(states[0]?.status).toBe("thin");
    expect(states[0]?.available.map((e) => e.champion)).not.toContain("Kalista");
    const masses = states.map((s) => s.mass);
    expect(masses).toEqual([...masses].sort((a, b) => a - b));
  });

  it("suggests bans by how much of a fragile player's remaining pool they take", () => {
    const ideas = banIdeas(analyseTeam(DEMO_SERIES.opponent, new Set()), 3);
    expect(ideas).toHaveLength(3);
    expect(ideas.every((i) => i.bite > 0 && i.bite <= 1)).toBe(true);
    expect(ideas.map((i) => i.bite)).toEqual([...ideas.map((i) => i.bite)].sort((a, b) => b - a));
  });
});
