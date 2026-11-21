// Evaluate a gradient-boosted tree ensemble (LightGBM, flattened by `lockout copilot-train`) in the browser.
import type { FlatTree } from "../api/types";

export type { FlatTree };

export function treeScore(trees: FlatTree[], x: number[]): number {
  let total = 0;
  for (const tree of trees) {
    let n = 0;
    while ((tree.f[n] as number) >= 0) n = (x[tree.f[n] as number] as number) <= (tree.t[n] as number) ? (tree.l[n] as number) : (tree.r[n] as number);
    total += tree.v[n] as number;
  }
  return total;
}
