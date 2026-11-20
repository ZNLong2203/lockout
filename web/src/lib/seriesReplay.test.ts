import { describe, expect, it } from "vitest";
import { demoSeriesDraft } from "../demo/series";
import { advanceReplay, truthOf, type ReplayState } from "./seriesReplay";

describe("series replay cursor", () => {
  const draft = demoSeriesDraft();
  const start: ReplayState = { draft, truth: truthOf(draft), gi: 0, step: 0, playing: true };

  it("maps the real games to board games for the first team", () => {
    expect(start.truth.map((g) => g.winner)).toEqual(["us", "them", "us"]);
    expect(start.truth[1]?.ourSide).toBe("red");
  });

  it("rolls over between games and stops at the end", () => {
    expect(advanceReplay({ ...start, step: 20 }, 1)).toMatchObject({ gi: 1, step: 0 });
    expect(advanceReplay({ ...start, gi: 1, step: 0 }, -1)).toMatchObject({ gi: 0, step: 20 });
    expect(advanceReplay({ ...start, gi: 2, step: 20 }, 1)).toMatchObject({ gi: 2, step: 20, playing: false });
  });
});
