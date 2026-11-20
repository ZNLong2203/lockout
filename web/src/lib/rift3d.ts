// Pure geometry for the 3D Rift. Everything is derived from our measured map (lib/map.ts); no Riot map art.
import { SUM } from "./map";

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
