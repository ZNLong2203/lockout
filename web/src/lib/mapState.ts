// What is alive on the map at a replay time: epic monsters and the river crabs from the feed's own spawn and
// kill events, jungle camps estimated from positions (the feed has no camp-clear events), and dead players.
import type { Replay, ReplayEvent } from "../api/types";
import { CAMPS, mirror } from "./map";

export type DragonKind = "infernal" | "ocean" | "cloud" | "mountain" | "hextech" | "chemtech" | "elder" | "dragon";
export type PitMonster = { kind: "baron" } | { kind: "herald" } | { kind: "grubs"; count: number };

export interface MapState {
  dragon: DragonKind | null;
  baronPit: PitMonster | null;
  atakhan: { kind: "voracious" | "ruinous" | "thornbound"; x: number; y: number } | null;
  scuttle: { top: boolean; bot: boolean };
  /** Keyed `${side}-${camp}`, e.g. "blue-red_buff". */
  camps: Record<string, boolean>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const DRAGONS: Record<string, DragonKind> = {
  infernaldrake: "infernal",
  oceandrake: "ocean",
  clouddrake: "cloud",
  mountaindrake: "mountain",
  hextechdrake: "hextech",
  chemtechdrake: "chemtech",
  elderdragon: "elder",
  dragon: "dragon",
};
const isDragon = (n: string) => n in DRAGONS;
const isGrub = (n: string) => n.startsWith("voidgrub");

// Jungle camp timers (seconds): first spawn and respawn after a clear.
export const CAMP_SPAWN = 90;
export const CAMP_RESPAWN: Record<string, number> = { blue_buff: 300, red_buff: 300, gromp: 135, wolves: 135, raptors: 135, krugs: 135 };
/** A camp counts as cleared once a player has stood this close to it for this many seconds in a row. */
export const CLEAR_RADIUS = 550;
export const CLEAR_DWELL = 4;

/** Time spans [from, to) during which each camp is down: before its first spawn and after each estimated clear. */
export function campDowntime(replay: Replay): Record<string, [number, number][]> {
  const out: Record<string, [number, number][]> = {};
  const last = replay.positions.length - 1;
  for (const side of ["blue", "red"] as const) {
    for (const [name, cp] of Object.entries(CAMPS)) {
      const [cx, cy] = mirror(cp, side);
      const down: [number, number][] = [[0, CAMP_SPAWN]];
      let aliveFrom = CAMP_SPAWN;
      let dwell = 0;
      for (let t = CAMP_SPAWN; t <= last; t++) {
        const row = replay.positions[t] ?? [];
        const near = replay.players.some((p) => {
          const at = row[p.slot];
          return !!at && at[0] >= 0 && Math.hypot(at[0] - cx, at[1] - cy) <= CLEAR_RADIUS;
        });
        if (t < aliveFrom) {
          dwell = 0;
          continue;
        }
        dwell = near ? dwell + 1 : 0;
        if (dwell >= CLEAR_DWELL) {
          aliveFrom = t + (CAMP_RESPAWN[name] ?? 135);
          down.push([t, aliveFrom]);
          dwell = 0;
        }
      }
      out[`${side}-${name}`] = down;
    }
  }
  return out;
}

const lastAt = (events: ReplayEvent[], t: number, test: (e: ReplayEvent) => boolean) => {
  let found: ReplayEvent | null = null;
  for (const e of events) if (e.t <= t && test(e)) found = e;
  return found;
};

/** The map at time t. Pass `downtime` from `campDowntime` (computed once per replay). */
export function mapStateAt(replay: Replay, t: number, downtime: Record<string, [number, number][]>): MapState {
  const ev = replay.events;
  const spawn = (test: (n: string) => boolean) => lastAt(ev, t, (e) => e.kind === "spawn" && test(norm(e.name)));
  const kill = (test: (n: string) => boolean) => lastAt(ev, t, (e) => e.kind === "objective" && test(norm(e.name)));
  const alive = (test: (n: string) => boolean) => {
    const s = spawn(test);
    const k = kill(test);
    return s && (!k || k.t < s.t) ? s : null;
  };

  const drake = alive(isDragon);
  const dragon = drake ? (DRAGONS[norm(drake.name)] ?? "dragon") : null;

  // The baron pit holds the grubs, then the herald, then baron: the latest spawn is the current occupant.
  let baronPit: PitMonster | null = null;
  const occupant = spawn((n) => n === "baron" || n === "riftherald" || isGrub(n));
  if (occupant) {
    const n = norm(occupant.name);
    if (isGrub(n)) {
      const wave = ev.filter((e) => e.kind === "spawn" && isGrub(norm(e.name)) && e.t <= t && e.t >= occupant.t - 1).length;
      const killed = ev.filter((e) => e.kind === "objective" && isGrub(norm(e.name)) && e.t <= t && e.t >= occupant.t).length;
      const count = Math.max(0, Math.min(3, wave) - killed);
      baronPit = count > 0 ? { kind: "grubs", count } : null;
    } else if (alive((m) => m === n)) {
      baronPit = { kind: n === "baron" ? "baron" : "herald" };
    }
  }

  // Atakhan's pit (top or bottom river) is only known from where it died in this game.
  let atakhan: MapState["atakhan"] = null;
  const ak = alive((n) => n.endsWith("atakhan"));
  if (ak) {
    const where = ev.find((e) => e.kind === "objective" && norm(e.name).endsWith("atakhan") && e.t >= ak.t && e.x !== null);
    if (where) {
      const n = norm(ak.name);
      atakhan = { kind: n.startsWith("ruinous") ? "ruinous" : n.startsWith("thornbound") ? "thornbound" : "voracious", x: where.x as number, y: where.y as number };
    }
  }

  const camps: Record<string, boolean> = {};
  for (const [key, spans] of Object.entries(downtime)) camps[key] = !spans.some(([a, b]) => t >= a && t < b);

  return {
    dragon,
    baronPit,
    atakhan,
    scuttle: { top: !!alive((n) => n === "riftscuttlertop"), bot: !!alive((n) => n === "riftscuttlerbot") },
    camps,
  };
}

/** Where a dead player fell (the last kill on them up to t), for the map's tombstone. */
export function deathSpot(replay: Replay, slot: number, t: number): { x: number; y: number } | null {
  const e = lastAt(replay.events, t, (k) => k.kind === "kill" && k.target_slot === slot && k.x !== null && k.y !== null);
  return e ? { x: e.x as number, y: e.y as number } : null;
}
