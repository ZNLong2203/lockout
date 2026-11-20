// Pure geometry for the 3D Rift. Everything is derived from our measured map (lib/map.ts); no Riot map art.
import { CAMPS, LANES, NEXUS, PITS, RIVER, SUM } from "./map";

/** Game units -> world units: 1 world unit = 1000 game units, map centred on the origin, game y -> -z. */
export const CENTER: [number, number] = [SUM[0] / 2, SUM[1] / 2];
export const toWorld = (x: number, y: number): [number, number, number] => [(x - CENTER[0]) / 1000, 0, -(y - CENTER[1]) / 1000];

function segDist(px: number, py: number, a: readonly number[], b: readonly number[]): number {
  const [ax, ay] = a as [number, number];
  const [bx, by] = b as [number, number];
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const k = len2 ? Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / len2, 0), 1) : 0;
  return Math.hypot(px - (ax + k * dx), py - (ay + k * dy));
}

export function polylineDist(x: number, y: number, path: readonly (readonly number[])[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) best = Math.min(best, segDist(x, y, path[i] as number[], path[i + 1] as number[]));
  return best;
}

// Deterministic hash noise in [0, 1): the jungle looks the same on every load.
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export interface Block {
  x: number;
  z: number;
  h: number; // height in world units
  w: number; // footprint in world units
}

/** Jungle massing: blocks wherever the map is neither lane, river, base, pit nor camp clearing. */
export function jungleBlocks(step = 520): Block[] {
  const lanes = Object.values(LANES);
  const camps = Object.values(CAMPS).flatMap((c) => [c, [SUM[0] - c[0], SUM[1] - c[1]]]);
  const keepOut: [readonly number[], number][] = [
    [NEXUS.blue, 2600],
    [NEXUS.red, 2600],
    [PITS.dragon, 1150],
    [PITS.baron, 1150],
    ...camps.map((c): [readonly number[], number] => [c, 700]),
  ];
  const out: Block[] = [];
  for (let x = 700; x <= 14200; x += step) {
    for (let y = 700; y <= 14200; y += step) {
      const jx = x + (hash(x, y) - 0.5) * step * 0.5;
      const jy = y + (hash(y, x) - 0.5) * step * 0.5;
      if (lanes.some((l) => polylineDist(jx, jy, l) < 1050)) continue;
      if (polylineDist(jx, jy, RIVER) < 1100) continue;
      if (keepOut.some(([c, r]) => Math.hypot(jx - (c[0] as number), jy - (c[1] as number)) < r)) continue;
      const [wx, , wz] = toWorld(jx, jy);
      out.push({ x: wx, z: wz, h: 0.18 + hash(jx, jy) * 0.75, w: (step / 1000) * (0.55 + hash(jy, jx) * 0.3) });
    }
  }
  return out;
}

export interface Tower {
  x: number;
  z: number;
  side: "blue" | "red";
}

/** Towers stand on the lane waypoints (the corner bends are not towers). */
export function towers(): Tower[] {
  const corner = (p: readonly number[]) => (p[0] as number) + (p[1] as number) > 13000 && Math.abs((p[0] as number) - (p[1] as number)) > 10000;
  return Object.values(LANES)
    .flat()
    .filter((p) => !corner(p))
    .map((p) => {
      const [x, , z] = toWorld(p[0] as number, p[1] as number);
      return { x, z, side: (p[0] as number) + (p[1] as number) < SUM[0] / 2 + SUM[1] / 2 ? "blue" : "red" };
    });
}
