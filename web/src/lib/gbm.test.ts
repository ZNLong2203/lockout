import { describe, expect, it } from "vitest";
import { treeScore, type FlatTree } from "./gbm";

describe("tree ensemble", () => {
  it("walks each tree to a leaf and adds the leaves", () => {
    // x0 <= 0.5 ? (x1 <= 2 ? 1 : 2) : 3
    const a: FlatTree = { f: [0, 1, -1, -1, -1], t: [0.5, 2, 0, 0, 0], l: [1, 2, 0, 0, 0], r: [4, 3, 0, 0, 0], v: [0, 0, 1, 2, 3] };
    const stump: FlatTree = { f: [-1], t: [0], l: [0], r: [0], v: [0.25] };
    expect(treeScore([a], [0.2, 1])).toBe(1);
    expect(treeScore([a], [0.2, 5])).toBe(2);
    expect(treeScore([a, stump], [0.9, 0])).toBe(3.25);
  });
});
