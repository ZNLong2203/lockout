import { describe, expect, it } from "vitest";
import type { Replay } from "../api/types";
import { describeEvent, frameAt, nearestEvent, trailOf } from "./replay";

const replay: Replay = {
  game_id: "g",
  series_id: "s",
  duration_s: 3,
  bounds: [0, 0, 15000, 15000],
  players: [
    { slot: 0, player_id: "a", name: "Alpha", side: "blue", role: "top", champion: null },
    { slot: 1, player_id: "b", name: "Bravo", side: "red", role: "mid", champion: "Ahri" },
  ],
  positions: [
    [[0, 0], [-1, -1]],
    [[100, 200], [500, 500]],
    [[-1, -1], [700, 900]],
    [[300, 400], [-1, -1]],
  ],
  events: [
    { t: 1, kind: "kill", name: "kill", slot: 0, target_slot: 1, x: 1, y: 1 },
    { t: 2, kind: "objective", name: "infernal-dragon", slot: 1, target_slot: null, x: null, y: null },
    { t: 2, kind: "respawn", name: "respawn", slot: null, target_slot: 1, x: null, y: null },
  ],
  blue_team: "Blue",
  red_team: "Red",
  winner_side: "blue",
};

describe("frameAt", () => {
  it("returns the sampled position on a whole second", () => {
    expect(frameAt(replay, 1)[0]).toEqual({ x: 100, y: 200 });
  });

  it("interpolates linearly between two seconds", () => {
    expect(frameAt(replay, 0.5)[0]).toEqual({ x: 50, y: 100 });
  });

  it("holds the last known position when the next sample is unknown, and hides players never seen", () => {
    expect(frameAt(replay, 1.5)[0]).toEqual({ x: 100, y: 200 });
    expect(frameAt(replay, 0)[1]).toBeNull();
  });

  it("clamps to the length of the game", () => {
    expect(frameAt(replay, 99)[0]).toEqual({ x: 300, y: 400 });
    expect(frameAt(replay, -4)[0]).toEqual({ x: 0, y: 0 });
  });
});

describe("trailOf", () => {
  it("returns the known positions of the last seconds, oldest first", () => {
    expect(trailOf(replay, 0, 3, 10)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 200 }, { x: 300, y: 400 }]);
    expect(trailOf(replay, 0, 3, 1)).toEqual([{ x: 300, y: 400 }]);
    expect(trailOf(replay, 1, 0, 5)).toEqual([]);
  });
});

describe("events", () => {
  it("names the players involved", () => {
    expect(describeEvent(replay, replay.events[0]!)).toBe("Alpha killed Bravo");
    expect(describeEvent(replay, replay.events[1]!)).toBe("Bravo took infernal dragon");
    expect(describeEvent(replay, replay.events[2]!)).toBe("Bravo respawned");
  });

  it("finds the key event closest to a time, ignoring respawns", () => {
    expect(nearestEvent(replay.events, 0)?.kind).toBe("kill");
    expect(nearestEvent(replay.events, 3)?.kind).toBe("objective");
    expect(nearestEvent([], 3)).toBeNull();
  });
});
