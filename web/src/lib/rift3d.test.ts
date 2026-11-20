import { describe, expect, it } from "vitest";
import { LANES, NEXUS, RIVER } from "./map";
import { CENTER, jungleBlocks, polylineDist, toWorld, towers } from "./rift3d";

describe("rift3d geometry", () => {
  it("centres the map on the origin and flips game y to -z", () => {
    expect(toWorld(CENTER[0], CENTER[1])).toEqual([0, 0, -0]);
    const [x, , z] = toWorld(CENTER[0] + 1000, CENTER[1] + 2000);
    expect(x).toBeCloseTo(1);
    expect(z).toBeCloseTo(-2);
  });

  it("measures distance to a polyline", () => {
    expect(polylineDist(0, 5, [[0, 0], [10, 0]])).toBeCloseTo(5);
    expect(polylineDist(15, 0, [[0, 0], [10, 0]])).toBeCloseTo(5);
  });

  it("keeps the jungle off lanes, river and bases, and is deterministic", () => {
    const blocks = jungleBlocks();
    expect(blocks.length).toBeGreaterThan(100);
    expect(jungleBlocks()).toEqual(blocks);
    for (const b of blocks) {
      const gx = b.x * 1000 + CENTER[0];
      const gy = -b.z * 1000 + CENTER[1];
      for (const lane of Object.values(LANES)) expect(polylineDist(gx, gy, lane)).toBeGreaterThan(1000);
      expect(polylineDist(gx, gy, RIVER)).toBeGreaterThan(1000);
      expect(Math.hypot(gx - NEXUS.blue[0], gy - NEXUS.blue[1])).toBeGreaterThan(2500);
    }
  });

  it("places towers for both sides and skips the lane corners", () => {
    const t = towers();
    expect(t.filter((x) => x.side === "blue").length).toBe(t.filter((x) => x.side === "red").length);
    expect(t.length).toBe(Object.values(LANES).flat().length - 2);
  });
});
