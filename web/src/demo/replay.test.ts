import { describe, expect, it } from "vitest";
import { demoReplay } from "./replay";

describe("synthetic demo replay", () => {
  const r = demoReplay();

  it("has ten players, five a side, one position each per second", () => {
    expect(r.players).toHaveLength(10);
    expect(r.players.filter((p) => p.side === "blue")).toHaveLength(5);
    expect(r.positions).toHaveLength(r.duration_s + 1);
    expect(r.positions.every((frame) => frame.length === 10)).toBe(true);
  });

  it("keeps every player inside the map", () => {
    const [x0, y0, x1, y1] = r.bounds;
    for (const frame of r.positions) {
      for (const [x, y] of frame) {
        expect(x).toBeGreaterThanOrEqual(x0);
        expect(x).toBeLessThanOrEqual(x1);
        expect(y).toBeGreaterThanOrEqual(y0);
        expect(y).toBeLessThanOrEqual(y1);
      }
    }
  });

  it("is deterministic", () => {
    expect(demoReplay().positions[400]).toEqual(r.positions[400]);
  });

  it("points its events at real players", () => {
    const slots = new Set(r.players.map((p) => p.slot));
    for (const e of r.events) {
      if (e.slot !== null) expect(slots.has(e.slot)).toBe(true);
      if (e.target_slot !== null) expect(slots.has(e.target_slot)).toBe(true);
    }
  });
});
