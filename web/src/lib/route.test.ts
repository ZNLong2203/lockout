import { describe, expect, it } from "vitest";
import { parseHash, replayLink, scoutingLink } from "./route";

describe("hash routes", () => {
  it("defaults to the draft room", () => {
    expect(parseHash("")).toEqual({ page: "draft" });
    expect(parseHash("#/nonsense")).toEqual({ page: "draft" });
    expect(parseHash("#/draft")).toEqual({ page: "draft" });
  });

  it("reads the team of the scouting page", () => {
    expect(parseHash("#/scouting")).toEqual({ page: "scouting", team: null });
    expect(parseHash("#/scouting/47497")).toEqual({ page: "scouting", team: "47497" });
  });

  it("reads the game and start time of the replay page", () => {
    expect(parseHash("#/replay")).toEqual({ page: "replay", game: null, t: 0 });
    expect(parseHash("#/replay/abc?t=1994")).toEqual({ page: "replay", game: "abc", t: 1994 });
    expect(parseHash("#/replay/abc?t=-5")).toEqual({ page: "replay", game: "abc", t: 0 });
    expect(parseHash("#/replay/abc?t=soon")).toEqual({ page: "replay", game: "abc", t: 0 });
  });

  it("round-trips the links the app builds, including ids that need escaping", () => {
    expect(parseHash(replayLink("a/b c", 61.4))).toEqual({ page: "replay", game: "a/b c", t: 61 });
    expect(parseHash(scoutingLink("x y"))).toEqual({ page: "scouting", team: "x y" });
    expect(replayLink("g")).toBe("#/replay/g");
  });
});
