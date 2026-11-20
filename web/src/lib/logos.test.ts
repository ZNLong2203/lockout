import { describe, expect, it } from "vitest";
import { opaqueLuminance, toLogoMap } from "./logos";

describe("logo map", () => {
  it("looks teams up by trimmed, lower-cased name", () => {
    const m = toLogoMap({ "Cloud9 ": "https://cdn/c9.png" });
    expect(m.get("cloud9")).toBe("https://cdn/c9.png");
    expect(m.get("t1")).toBeUndefined();
  });

  it("measures only the opaque pixels of a crest", () => {
    const black = [0, 0, 0, 255];
    const clearWhite = [255, 255, 255, 0];
    expect(opaqueLuminance([...black, ...clearWhite])).toBe(0);
    expect(opaqueLuminance([255, 255, 255, 255])).toBeCloseTo(1);
    expect(opaqueLuminance(clearWhite)).toBeNull();
  });
});
