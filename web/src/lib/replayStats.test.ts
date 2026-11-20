import { describe, expect, it } from "vitest";
import type { Replay, ReplayEvent } from "../api/types";
import { categorize, keyEvents, nextEvent, playersAt, scoreAt } from "./replayStats";

const ev = (t: number, kind: string, name: string, slot: number | null, target: number | null = null): ReplayEvent => ({ t, kind, name, slot, target_slot: target, x: 100, y: 100 });

const replay: Replay = {
  game_id: "g",
  series_id: "s",
  duration_s: 600,
  bounds: [0, 0, 15000, 15000],
  players: [
    { slot: 0, player_id: "a", name: "Ann", side: "blue", role: "mid", champion: "Ahri" },
    { slot: 5, player_id: "b", name: "Bob", side: "red", role: "mid", champion: "Azir" },
  ],
  positions: [],
  events: [
    ev(100, "kill", "kill", 0, 5),
    ev(130, "respawn", "respawn", null, 5),
    ev(300, "objective", "OceanDrake", 5),
    ev(301, "objective", "Dragon", 5),
    ev(400, "structure", "tower", 0),
    ev(420, "structure", "inhibitor", 0),
    ev(500, "kill", "kill", 5, 0),
  ],
  blue_team: "Blue",
  red_team: "Red",
  winner_side: "blue",
};

describe("replay stats", () => {
  it("classifies events", () => {
    expect(categorize(ev(1, "objective", "InfernalDrake", 0))).toBe("dragon");
    expect(categorize(ev(1, "objective", "Baron", 0))).toBe("baron");
    expect(categorize(ev(1, "structure", "inhibitor", 0))).toBe("inhibitor");
    expect(categorize(ev(1, "objective", "RiftScuttlerTop", 0))).toBe("scuttle");
  });

  it("drops the generic Dragon twin of a typed drake", () => {
    const names = keyEvents(replay).map((e) => e.name);
    expect(names).toContain("OceanDrake");
    expect(names).not.toContain("Dragon");
    expect(names).not.toContain("respawn");
  });

  it("scores each side up to time t", () => {
    expect(scoreAt(replay, 50).blue.kills).toBe(0);
    const s = scoreAt(replay, 450);
    expect(s.blue).toMatchObject({ kills: 1, towers: 1, inhibitors: 1 });
    expect(s.red).toMatchObject({ kills: 0, dragons: 1 });
  });

  it("tracks kills, deaths and who is dead with a respawn countdown", () => {
    const at = playersAt(replay, 110);
    expect(at[0]).toMatchObject({ kills: 1, deaths: 0, dead: false });
    expect(at[5]).toMatchObject({ kills: 0, deaths: 1, dead: true, respawnIn: 20 });
    expect(playersAt(replay, 131)[5]?.dead).toBe(false);
    // no respawn event: assumed dead for 30 s
    expect(playersAt(replay, 520)[0]?.dead).toBe(true);
    expect(playersAt(replay, 540)[0]?.dead).toBe(false);
  });

  it("finds the next key moment", () => {
    const events = keyEvents(replay);
    expect(nextEvent(events, 100)?.t).toBe(300);
    expect(nextEvent(events, 600)).toBeNull();
  });
});
