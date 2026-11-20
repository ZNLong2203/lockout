// SYNTHETIC demo replay. The movement is generated from the map geometry; nothing comes from the licensed GRID data.
import type { Replay, ReplayEvent, ReplayPlayer, Role } from "../api/types";
import { CAMPS, LANES, NEXUS, PITS, SUM, along } from "../lib/map";

export const DEMO_REPLAY_ID = "demo-game-1";
const DURATION = 900;
const DRAGON_T = 612;

// Blue is "Team Alpha", red is "Team Bravo" (game 1 of the demo series).
const BLUE: [string, Role, string][] = [["Atlas", "top", "Renekton"], ["Vector", "jungle", "Sejuani"], ["Nova", "mid", "Ahri"], ["Echo", "adc", "Ezreal"], ["Halo", "support", "Braum"]];
const RED: [string, Role, string][] = [["Granite", "top", "Gnar"], ["Viper", "jungle", "Lee Sin"], ["Sable", "mid", "Viktor"], ["Quill", "adc", "Jhin"], ["Mender", "support", "Alistar"]];
const LANE_OF: Record<Role, "top" | "mid" | "bot"> = { top: "top", mid: "mid", adc: "bot", support: "bot", jungle: "mid", unknown: "mid" };
const BLUE_CAMPS = ["blue_buff", "gromp", "wolves", "raptors", "red_buff", "krugs"] as const;

type XY = [number, number];
const flip = ([x, y]: XY): XY => [SUM[0] - x, SUM[1] - y];
const lerp = (a: XY, b: XY, k: number): XY => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

function target(role: Role, side: "blue" | "red", slot: number, t: number): XY {
  const sway = Math.sin(t / 23 + slot * 1.7);
  const lane = LANES[LANE_OF[role]] as XY[];
  const pit: XY = [...PITS.dragon] as XY;
  const near = t > DRAGON_T - 45 && t < DRAGON_T + 8;
  if (near && (role === "jungle" || role === "adc" || role === "support" || role === "mid")) {
    const spot = side === "blue" ? 0 : 1; // the red team hovers by the river, the blue team takes the pit
    return [pit[0] + (spot ? 900 : -250) + sway * 250, pit[1] + (spot ? 700 : -300) + sway * 200];
  }
  if (role === "jungle") {
    if (t < 330) {
      const step = Math.floor(Math.max(t - 90, 0) / 40) % BLUE_CAMPS.length;
      const camp = CAMPS[BLUE_CAMPS[step] as string] as XY;
      return side === "blue" ? camp : flip(camp);
    }
    return along(lane, side === "blue" ? 0.46 + 0.05 * sway : 0.54 - 0.05 * sway);
  }
  // blue holds the near half of the lane, red the far half, and they trade a little
  return along(lane, side === "blue" ? 0.4 + 0.04 * sway : 0.6 - 0.04 * sway);
}

function position(role: Role, side: "blue" | "red", slot: number, t: number): XY {
  const base: XY = [...NEXUS[side]] as XY;
  const spread: XY = [base[0] + (slot % 5) * 120, base[1] + (slot % 5) * 90];
  if (t < 70) return spread;
  const goal = target(role, side, slot, t);
  return t < 130 ? lerp(spread, goal, (t - 70) / 60) : goal;
}

export function demoReplay(): Replay {
  const players: ReplayPlayer[] = [...BLUE, ...RED].map(([name, role, champion], slot) => ({
    slot,
    player_id: `demo-${slot}`,
    name,
    side: slot < 5 ? "blue" : "red",
    role,
    champion,
  }));
  const positions = Array.from({ length: DURATION + 1 }, (_, t) =>
    players.map((p): [number, number] => {
      const [x, y] = position(p.role, p.side, p.slot, t);
      return [Math.round(x), Math.round(y)];
    }),
  );
  const events: ReplayEvent[] = [
    { t: 215, kind: "kill", name: "kill", slot: 2, target_slot: 7, x: 6295, y: 6666 },
    { t: 245, kind: "respawn", name: "respawn", slot: null, target_slot: 7, x: null, y: null },
    { t: 338, kind: "kill", name: "kill", slot: 8, target_slot: 0, x: 1472, y: 7032 },
    { t: 368, kind: "respawn", name: "respawn", slot: null, target_slot: 0, x: null, y: null },
    { t: DRAGON_T, kind: "objective", name: "infernal-dragon", slot: 1, target_slot: null, x: PITS.dragon[0], y: PITS.dragon[1] },
    { t: 640, kind: "kill", name: "kill", slot: 3, target_slot: 9, x: 9800, y: 5200 },
    { t: 840, kind: "structure", name: "red-turret-mid-1", slot: 2, target_slot: null, x: 9649, y: 9729 },
  ];
  return {
    game_id: DEMO_REPLAY_ID,
    series_id: "demo-series",
    duration_s: DURATION,
    bounds: [0, 0, 15000, 15000],
    players,
    positions,
    events,
    blue_team: "Team Alpha",
    red_team: "Team Bravo",
    winner_side: "blue",
  };
}
