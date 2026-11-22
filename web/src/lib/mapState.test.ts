import { describe, expect, it } from "vitest";
import type { Replay, ReplayEvent } from "../api/types";
import { CAMPS, mirror } from "./map";
import { CAMP_SPAWN, campDowntime, deathSpot, mapStateAt } from "./mapState";

const ev = (t: number, kind: string, name: string, x: number | null = null, y: number | null = null, target: number | null = null): ReplayEvent => ({
  t,
  kind,
  name,
  slot: 0,
  target_slot: target,
  x,
  y,
});

// One blue jungler: walks to blue-side red buff at 100 s and stays 6 s, otherwise far away (unknown).
const red = mirror(CAMPS.red_buff as [number, number], "blue");
const positions: [number, number][][] = Array.from({ length: 700 }, (_, t) => [t >= 100 && t < 106 ? red : [-1, -1]]);

const replay: Replay = {
  game_id: "g",
  series_id: "s",
  duration_s: 700,
  bounds: [0, 0, 15000, 15000],
  players: [{ slot: 0, player_id: "a", name: "Ann", side: "blue", role: "jungle", champion: "Vi" }],
  positions,
  events: [
    ev(300, "spawn", "voidGrub1"),
    ev(300, "spawn", "voidGrub2"),
    ev(300, "spawn", "voidGrub3"),
    ev(320, "objective", "VoidGrub", 4700, 10000),
    ev(330, "spawn", "infernalDrake"),
    ev(400, "objective", "InfernalDrake", 10000, 4800),
    ev(400, "objective", "Dragon", 10000, 4800),
    ev(450, "kill", "kill", 5000, 6000, 0),
    ev(500, "spawn", "riftHerald"),
    ev(600, "spawn", "voraciousAtakhan"),
    ev(650, "objective", "VoraciousAtakhan", 3100, 11600),
    ev(210, "spawn", "riftScuttlerTop"),
  ],
  blue_team: "Blue",
  red_team: "Red",
  winner_side: "blue",
};

describe("map state", () => {
  const down = campDowntime(replay);

  it("spawns camps at 1:30 and takes one down after a player stands on it", () => {
    expect(mapStateAt(replay, CAMP_SPAWN - 1, down).camps["blue-red_buff"]).toBe(false);
    expect(mapStateAt(replay, 95, down).camps["blue-red_buff"]).toBe(true);
    expect(mapStateAt(replay, 104, down).camps["blue-red_buff"]).toBe(false); // cleared after 4 s
    expect(mapStateAt(replay, 103 + 300, down).camps["blue-red_buff"]).toBe(true); // buffs return after 5:00
    expect(mapStateAt(replay, 200, down).camps["red-red_buff"]).toBe(true);
  });

  it("follows the feed for the dragon, its element and the grubs", () => {
    expect(mapStateAt(replay, 310, down).baronPit).toEqual({ kind: "grubs", count: 3 });
    expect(mapStateAt(replay, 325, down).baronPit).toEqual({ kind: "grubs", count: 2 });
    expect(mapStateAt(replay, 340, down).dragon).toBe("infernal");
    expect(mapStateAt(replay, 401, down).dragon).toBeNull();
    expect(mapStateAt(replay, 510, down).baronPit).toEqual({ kind: "herald" });
  });

  it("places Atakhan where it died in this game, and the crabs by their events", () => {
    expect(mapStateAt(replay, 620, down).atakhan).toMatchObject({ kind: "voracious", x: 3100, y: 11600 });
    expect(mapStateAt(replay, 660, down).atakhan).toBeNull();
    expect(mapStateAt(replay, 200, down).scuttle.top).toBe(false);
    expect(mapStateAt(replay, 220, down).scuttle).toEqual({ top: true, bot: false });
  });

  it("finds where a dead player fell", () => {
    expect(deathSpot(replay, 0, 460)).toEqual({ x: 5000, y: 6000 });
    expect(deathSpot(replay, 0, 440)).toBeNull();
  });
});
