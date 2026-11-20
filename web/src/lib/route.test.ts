import { describe, expect, it } from "vitest";
import { draftLink, parseHash, replayLink, scoutingLink, teamLink } from "./route";

describe("hash routes", () => {
  it("defaults to the home page", () => {
    expect(parseHash("")).toEqual({ page: "home" });
    expect(parseHash("#/")).toEqual({ page: "home" });
    expect(parseHash("#/nonsense")).toEqual({ page: "home" });
  });

  it("reads the team page and its tab, and keeps old scouting links working", () => {
    expect(parseHash("#/team/47497")).toEqual({ page: "team", team: "47497", tab: "overview" });
    expect(parseHash("#/team/47497?tab=map")).toEqual({ page: "team", team: "47497", tab: "map" });
    expect(parseHash("#/team/47497?tab=bogus")).toEqual({ page: "team", team: "47497", tab: "overview" });
    expect(parseHash("#/scouting/47497")).toEqual({ page: "team", team: "47497", tab: "overview" });
    expect(parseHash("#/scouting")).toEqual({ page: "team", team: null, tab: "overview" });
  });

  it("reads the matchup of the draft room", () => {
    expect(parseHash("#/draft")).toEqual({ page: "draft", us: null, vs: null });
    expect(parseHash("#/draft?us=1&vs=2")).toEqual({ page: "draft", us: "1", vs: "2" });
  });

  it("reads the game and start time of the replay page", () => {
    expect(parseHash("#/replay")).toEqual({ page: "replay", game: null, t: 0 });
    expect(parseHash("#/replay/abc?t=1994")).toEqual({ page: "replay", game: "abc", t: 1994 });
    expect(parseHash("#/replay/abc?t=-5")).toEqual({ page: "replay", game: "abc", t: 0 });
    expect(parseHash("#/replay/abc?t=soon")).toEqual({ page: "replay", game: "abc", t: 0 });
  });

  it("round-trips the links the app builds, including ids that need escaping", () => {
    expect(parseHash(replayLink("a/b c", 61.4))).toEqual({ page: "replay", game: "a/b c", t: 61 });
    expect(parseHash(scoutingLink("x y"))).toEqual({ page: "team", team: "x y", tab: "overview" });
    expect(parseHash(teamLink("x", "games"))).toEqual({ page: "team", team: "x", tab: "games" });
    expect(parseHash(draftLink("a b", "c"))).toEqual({ page: "draft", us: "a b", vs: "c" });
    expect(draftLink()).toBe("#/draft");
    expect(replayLink("g")).toBe("#/replay/g");
  });
});
