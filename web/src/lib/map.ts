// Geometry of our own stylised Summoner's Rift, measured from the GRID data (src/lockout/geometry.py).
// No Riot map art is used. Game units run 0..15000 with y pointing up; the SVG flips y with `P`.
export const S = 15000;

export const LANES: Record<string, [number, number][]> = {
  top: [[1444, 3768], [1374, 4450], [1472, 7032], [1254, 10615], [1500, 13300], [4171, 13608], [7670, 13457], [10320, 13541], [10964, 13363]],
  mid: [[3205, 3342], [3681, 3785], [5191, 5147], [6295, 6666], [8583, 8156], [9649, 9729], [11101, 11053], [11710, 11451]],
  bot: [[3701, 1453], [4409, 1366], [7193, 1426], [10650, 1293], [13300, 1500], [13596, 4368], [13385, 7906], [13464, 10392], [13327, 11049]],
};
export const CAMPS: Record<string, [number, number]> = {
  blue_buff: [3800, 7900], gromp: [2100, 8400], wolves: [3800, 6500],
  raptors: [6900, 5400], red_buff: [7800, 4000], krugs: [8400, 2700],
};
export const TOP_SIDE = new Set(["blue_buff", "gromp", "wolves"]);
export const NEXUS = { blue: [1774, 1598], red: [13074, 13090] } as const;
export const PITS = { dragon: [10020, 4790], baron: [4970, 10290] } as const;
export const RIVER: [number, number][] = [[1900, 12500], [4900, 10000], [7400, 7350], [10000, 4800], [12900, 2200]];
export const LANE_LABEL: Record<string, [number, number]> = { top: [2300, 12600], mid: [7900, 7000], bot: [12500, 2300] };

// The map is symmetric under a half-turn: a blue-side point maps to the red side through this sum.
export const SUM: [number, number] = [NEXUS.blue[0] + NEXUS.red[0], NEXUS.blue[1] + NEXUS.red[1]];

/** SVG point of a game position (y is flipped). */
export const P = ([x, y]: readonly [number, number]) => `${x},${S - y}`;
export const mirror = ([x, y]: [number, number], side: "blue" | "red"): [number, number] =>
  side === "blue" ? [x, y] : [SUM[0] - x, SUM[1] - y];

/** Point at fraction `f` (0..1) along a polyline. */
export function along(path: [number, number][], f: number): [number, number] {
  const segs = path.slice(1).map((p, i) => Math.hypot(p[0] - (path[i] as [number, number])[0], p[1] - (path[i] as [number, number])[1]));
  const total = segs.reduce((a, b) => a + b, 0);
  let want = Math.min(Math.max(f, 0), 1) * total;
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i] as number;
    if (want <= len || i === segs.length - 1) {
      const a = path[i] as [number, number];
      const b = path[i + 1] as [number, number];
      const k = len ? want / len : 0;
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    want -= len;
  }
  return path[0] as [number, number];
}
