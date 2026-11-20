import { describe, expect, it } from "vitest";
import { CENTER, polylineDist, toWorld } from "./rift3d";

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
});
