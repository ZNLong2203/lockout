// Turns Riot's official minimap (Data Dragon map11.png, loaded at runtime, never stored) into a height field.
// The minimap is schematic: black = walls, blue = river, olive = walkable ground, grey-blue = bases.

export type Cell = "wall" | "river" | "base" | "ground" | "void";

/** Game units covered by the minimap image (x to the right, y up). */
export const MAP_EXTENT: [number, number] = [14870, 14980];

export function classify(r: number, g: number, b: number): Cell {
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum < 0.09) return "wall";
  if (b > r + 60 && b > g + 25) return "river";
  if (b >= r && Math.abs(g - b) < 40 && r < 140) return "base";
  return "ground";
}

export const BASE_HEIGHT: Record<Cell, number> = { wall: 1, river: -0.35, base: 0.06, ground: 0, void: 0 };

/** Height per pixel (row-major, row 0 = top of the image = high game y), smoothed so walls read as rock. */
export function heightField(rgba: Uint8ClampedArray, size: number, passes = 3): { h: Float32Array; cells: Cell[] } {
  const cells: Cell[] = new Array(size * size);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const c = classify(rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number);
    cells[i] = c;
    h[i] = BASE_HEIGHT[c];
  }
  let cur = h;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
            sum += cur[yy * size + xx] as number;
            n++;
          }
        }
        next[y * size + x] = sum / n;
      }
    }
    cur = next;
  }
  return { h: cur, cells };
}

/** Bilinear sample of a size x size field at image coordinates (u, v) in [0, 1]. */
export function sample(field: Float32Array, size: number, u: number, v: number): number {
  const fx = Math.min(Math.max(u * (size - 1), 0), size - 1);
  const fy = Math.min(Math.max(v * (size - 1), 0), size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const kx = fx - x0;
  const ky = fy - y0;
  const at = (x: number, y: number) => field[y * size + x] as number;
  return (at(x0, y0) * (1 - kx) + at(x1, y0) * kx) * (1 - ky) + (at(x0, y1) * (1 - kx) + at(x1, y1) * kx) * ky;
}

/** Game position -> image coordinates (u to the right, v down). */
export const toImage = (x: number, y: number): [number, number] => [x / MAP_EXTENT[0], 1 - y / MAP_EXTENT[1]];
