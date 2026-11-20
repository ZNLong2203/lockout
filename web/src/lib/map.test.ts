import { describe, expect, it } from "vitest";
import { LANES, NEXUS, SUM, along, mirror, structures } from "./map";

describe("map geometry", () => {
  it("mirrors a blue-side point onto the red side and back", () => {
    const blue: [number, number] = [3800, 7900];
    const red = mirror(blue, "red");
    expect(red).toEqual([SUM[0] - 3800, SUM[1] - 7900]);
    expect(mirror(red, "red")).toEqual(blue);
    expect(mirror(blue, "blue")).toEqual(blue);
    expect(mirror([...NEXUS.blue] as [number, number], "red")).toEqual([...NEXUS.red]);
  });

  it("walks along a lane from the blue end to the red end", () => {
    const path = LANES.mid as [number, number][];
    const first = path[0]!;
    const last = path[path.length - 1]!;
    const near = (got: [number, number], want: [number, number]) => {
      expect(got[0]).toBeCloseTo(want[0], 6);
      expect(got[1]).toBeCloseTo(want[1], 6);
    };
    near(along(path, 0), first);
    near(along(path, 1), last);
    near(along(path, -1), first); // clamped
    near(along(path, 2), last);
    const mid = along(path, 0.5);
    expect(mid[0]).toBeGreaterThan(path[0]![0]);
    expect(mid[0]).toBeLessThan(path[path.length - 1]![0]);
  });

  it("interpolates inside a segment", () => {
    expect(along([[0, 0], [10, 0]], 0.25)).toEqual([2.5, 0]);
  });
});


describe("structures", () => {
  it("lists every structure a side and tells inhibitors from turrets", () => {
    const all = structures();
    for (const side of ["blue", "red"] as const) {
      const mine = all.filter((s) => s.side === side);
      expect(mine.filter((s) => s.kind === "inhibitor")).toHaveLength(3);
      expect(mine.filter((s) => s.kind === "turret")).toHaveLength(9);
      expect(mine.filter((s) => s.kind === "nexus_turret")).toHaveLength(2);
      expect(mine.filter((s) => s.kind === "nexus")).toHaveLength(1);
    }
  });
});
