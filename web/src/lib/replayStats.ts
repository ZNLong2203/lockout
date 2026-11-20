// Live game state at replay time t, computed from the replay's events (pure, tested).
import type { Replay, ReplayEvent, Side } from "../api/types";

export type Category = "kill" | "dragon" | "baron" | "herald" | "grubs" | "atakhan" | "scuttle" | "tower" | "inhibitor" | "nexus" | "other";

export function categorize(e: ReplayEvent): Category {
  if (e.kind === "kill") return "kill";
  if (e.kind === "structure") return e.name === "inhibitor" ? "inhibitor" : e.name === "nexus" ? "nexus" : "tower";
  if (e.kind !== "objective") return "other";
  if (e.name.endsWith("Drake") || e.name === "Dragon" || e.name === "ElderDragon") return "dragon";
  if (e.name === "Baron") return "baron";
  if (e.name === "RiftHerald") return "herald";
  if (e.name === "VoidGrub") return "grubs";
  if (e.name.includes("Atakhan")) return "atakhan";
  if (e.name.startsWith("RiftScuttler")) return "scuttle";
  return "other";
}

/** Key events in order, without the feed's generic "Dragon" twin of a typed drake kill. */
export function keyEvents(replay: Replay): ReplayEvent[] {
  const typedDrakes = replay.events.filter((e) => e.kind === "objective" && e.name.endsWith("Drake"));
  return replay.events
    .filter((e) => e.kind === "kill" || e.kind === "objective" || e.kind === "structure")
    .filter((e) => !(e.kind === "objective" && e.name === "Dragon" && typedDrakes.some((d) => Math.abs(d.t - e.t) <= 3)))
    .sort((a, b) => a.t - b.t);
}

export const sideOfSlot = (replay: Replay, slot: number | null): Side | null =>
  slot === null ? null : (replay.players.find((p) => p.slot === slot)?.side ?? null);

export interface TeamScore {
  kills: number;
  towers: number;
  inhibitors: number;
  dragons: number;
  barons: number;
  heralds: number;
  grubs: number;
}

const empty = (): TeamScore => ({ kills: 0, towers: 0, inhibitors: 0, dragons: 0, barons: 0, heralds: 0, grubs: 0 });

export function scoreAt(replay: Replay, t: number, events = keyEvents(replay)): Record<Side, TeamScore> {
  const out = { blue: empty(), red: empty() };
  for (const e of events) {
    if (e.t > t) break;
    const side = sideOfSlot(replay, e.slot);
    if (!side) continue;
    const s = out[side];
    switch (categorize(e)) {
      case "kill": s.kills++; break;
      case "tower": s.towers++; break;
      case "inhibitor": s.inhibitors++; break;
      case "dragon": s.dragons++; break;
      case "baron": s.barons++; break;
      case "herald": s.heralds++; break;
      case "grubs": s.grubs++; break;
      default: break;
    }
  }
  return out;
}

export interface PlayerState {
  kills: number;
  deaths: number;
  dead: boolean;
  respawnIn: number | null; // seconds until the next respawn event, when dead
}

export function playersAt(replay: Replay, t: number): Record<number, PlayerState> {
  const out: Record<number, PlayerState> = {};
  for (const p of replay.players) out[p.slot] = { kills: 0, deaths: 0, dead: false, respawnIn: null };
  const lastDeath: Record<number, number> = {};
  for (const e of replay.events) {
    if (e.kind !== "kill" || e.t > t) continue;
    if (e.slot !== null && out[e.slot]) (out[e.slot] as PlayerState).kills++;
    if (e.target_slot !== null && out[e.target_slot]) {
      (out[e.target_slot] as PlayerState).deaths++;
      lastDeath[e.target_slot] = Math.max(lastDeath[e.target_slot] ?? -1, e.t);
    }
  }
  for (const [slotStr, died] of Object.entries(lastDeath)) {
    const slot = Number(slotStr);
    const respawn = replay.events.find((e) => e.kind === "respawn" && e.target_slot === slot && e.t > died);
    const state = out[slot] as PlayerState;
    if (respawn ? t < respawn.t : t - died < 30) {
      state.dead = true;
      state.respawnIn = respawn ? Math.ceil(respawn.t - t) : null;
    }
  }
  return out;
}

/** The first key event strictly after t (for "next moment"). */
export const nextEvent = (events: ReplayEvent[], t: number) => events.find((e) => e.t > t + 0.5) ?? null;
