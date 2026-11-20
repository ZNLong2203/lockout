import type { Replay, ReplayEvent } from "../api/types";

export type Point = { x: number; y: number };

const known = (p: readonly [number, number] | undefined): p is [number, number] => !!p && p[0] >= 0 && p[1] >= 0;

/** Where every player is at game time `t` (seconds, fractional): linear between the two nearest seconds. */
export function frameAt(replay: Replay, t: number): (Point | null)[] {
  const last = replay.positions.length - 1;
  const i = Math.min(Math.max(Math.floor(t), 0), last);
  const k = Math.min(Math.max(t - i, 0), 1);
  const a = replay.positions[i] ?? [];
  const b = replay.positions[Math.min(i + 1, last)] ?? a;
  return replay.players.map((p) => {
    const from = a[p.slot];
    const to = b[p.slot];
    if (!known(from)) return known(to) && k > 0.5 ? { x: to[0], y: to[1] } : null;
    if (!known(to)) return { x: from[0], y: from[1] };
    return { x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k };
  });
}

/** The last `seconds` of a player's path ending at `t`, one point per second. */
export function trailOf(replay: Replay, slot: number, t: number, seconds: number): Point[] {
  const end = Math.min(Math.floor(t), replay.positions.length - 1);
  const out: Point[] = [];
  for (let s = Math.max(0, end - seconds); s <= end; s++) {
    const p = replay.positions[s]?.[slot];
    if (known(p)) out.push({ x: p[0], y: p[1] });
  }
  return out;
}

export const EVENT_KIND_LABEL: Record<string, string> = {
  kill: "Kill",
  objective: "Objective",
  structure: "Structure",
  spawn: "Spawn",
  respawn: "Respawn",
};

// Feed names are identifiers ("RiftScuttlerTop", "OceanDrake", "blue-turret-mid-1"); make them read as words.
const PRETTY: Record<string, string> = {
  RiftScuttlerTop: "the top Rift Scuttler",
  RiftScuttlerBot: "the bottom Rift Scuttler",
  VoidGrub: "a Void Grub",
};
const tidy = (s: string) =>
  PRETTY[s] ??
  s
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

/** A one-line description of an event, naming the players involved. */
export function describeEvent(replay: Replay, e: ReplayEvent): string {
  const name = (slot: number | null) => replay.players.find((p) => p.slot === slot)?.name ?? "Someone";
  switch (e.kind) {
    case "kill":
      return `${name(e.slot)} killed ${name(e.target_slot)}`;
    case "objective":
      return `${name(e.slot)} took ${tidy(e.name)}`;
    case "structure":
      return `${name(e.slot)} destroyed ${tidy(e.name)}`;
    case "respawn":
      return `${name(e.target_slot)} respawned`;
    default:
      return `${tidy(e.name)} ${e.kind}`;
  }
}

/** The events worth listing and marking on the timeline (respawns and spawns are only noise there). */
export const KEY_EVENTS = new Set(["kill", "objective", "structure"]);

export const nearestEvent = (events: ReplayEvent[], t: number) =>
  events.filter((e) => KEY_EVENTS.has(e.kind)).reduce<ReplayEvent | null>((best, e) => (best === null || Math.abs(e.t - t) < Math.abs(best.t - t) ? e : best), null);
