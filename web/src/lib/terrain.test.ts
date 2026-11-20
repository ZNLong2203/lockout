import { describe, expect, it } from "vitest";
import { PITS } from "./map";
import { classify, heightField, sample, toImage } from "./terrain";

describe("terrain from the minimap", () => {
  it("classifies the schematic colours", () => {
    expect(classify(5, 8, 6)).toBe("wall");
    expect(classify(20, 120, 170)).toBe("river");
    expect(classify(150, 160, 110)).toBe("ground");
    expect(classify(90, 110, 120)).toBe("base");
  });

  it("raises walls, sinks the river and smooths the edge between them", () => {
    const size = 8;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const wall = i % size < 4;
      rgba.set(wall ? [0, 0, 0, 255] : [150, 160, 110, 255], i * 4);
    }
    const { h, cells } = heightField(rgba, size, 1);
    expect(cells[0]).toBe("wall");
    expect(cells[7]).toBe("ground");
    expect(h[0]).toBeCloseTo(1);
    expect(h[7]).toBeCloseTo(0);
    expect(h[4] as number).toBeGreaterThan(0);
    expect(h[4] as number).toBeLessThan(1);
  });

  it("samples bilinearly and maps game positions onto the image", () => {
    const f = new Float32Array([0, 1, 0, 1]);
    expect(sample(f, 2, 0.5, 0)).toBeCloseTo(0.5);
    const [u, v] = toImage(PITS.dragon[0], PITS.dragon[1]);
    // the dragon pit sits in the lower-right river, as on the real minimap
    expect(u).toBeGreaterThan(0.6);
    expect(v).toBeGreaterThan(0.6);
  });
});
