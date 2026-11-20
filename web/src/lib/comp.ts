// Team composition check. Damage profile, frontline and range come from Riot's own classification in Data
// Dragon (`tags` and the 0-10 `info` ratings). Engage and power curve are not in any Riot file, so they use the
// small editorial lists below; the UI labels them as such.
import type { ChampInfo } from "./ddragon";

/** Hard engage: a reliable way to start a teamfight or catch someone (editorial). */
export const ENGAGE = new Set([
  "Alistar", "Amumu", "Camille", "Diana", "Galio", "Gragas", "Hecarim", "Jarvan IV", "Kennen", "K'Sante", "Leona",
  "Lissandra", "Malphite", "Maokai", "Nautilus", "Nocturne", "Ornn", "Poppy", "Rakan", "Rammus", "Rell", "Sejuani",
  "Sion", "Skarner", "Thresh", "Vi", "Wukong", "Xin Zhao", "Zac", "Zyra", "Lee Sin", "Rumble", "Ambessa", "Pyke",
]);

/** Champions that peak early (lane bullies, early skirmishers) and ones that scale late (editorial). */
export const EARLY = new Set([
  "Renekton", "Lee Sin", "Elise", "Draven", "Lucian", "Pantheon", "Xin Zhao", "Jayce", "Kalista", "Nidalee",
  "Rek'Sai", "Olaf", "Kled", "Tahm Kench", "Leona", "Nautilus", "Rell", "Corki", "Ezreal", "Caitlyn", "Jarvan IV",
  "Viego", "Trundle", "Kindred", "Taliyah", "Graves", "Wukong", "Sylas", "Yasuo",
]);
export const LATE = new Set([
  "Kayle", "Kassadin", "Vayne", "Jinx", "Kog'Maw", "Aphelios", "Azir", "Ryze", "Veigar", "Smolder", "Twitch", "Gwen",
  "Jax", "Viktor", "Cassiopeia", "Senna", "Zeri", "Kai'Sa", "Ornn", "Yone", "Orianna", "Aurora", "Hwei", "Seraphine",
  "Karthus", "Nasus", "Fiora", "Gangplank", "Xayah", "Sivir", "Ziggs", "Mel", "Yunara",
]);

export interface Composition {
  champions: number;
  physical: number; // share of the damage weight that is physical (0..1)
  magic: number;
  frontline: number; // tanks, plus fighters with a defense rating of 6+
  engage: number;
  ranged: number; // basic attack range above 300 units
  curve: number; // -1 (all early) .. +1 (all late)
  warnings: string[];
}

const isFrontline = (info: ChampInfo) => info.tags.includes("Tank") || (info.tags.includes("Fighter") && info.defense >= 6);

export function composition(champions: string[], infoOf: (name: string) => ChampInfo | undefined): Composition {
  let phys = 0;
  let mag = 0;
  let frontline = 0;
  let engage = 0;
  let ranged = 0;
  let curve = 0;
  for (const c of champions) {
    const info = infoOf(c);
    if (info) {
      phys += info.attack;
      mag += info.magic;
      if (isFrontline(info)) frontline++;
      if (info.range > 300) ranged++;
    }
    if (ENGAGE.has(c)) engage++;
    if (EARLY.has(c)) curve--;
    if (LATE.has(c)) curve++;
  }
  const total = phys + mag;
  const n = champions.length;
  const physical = total ? phys / total : 0.5;
  const out: Composition = {
    champions: n,
    physical,
    magic: total ? mag / total : 0.5,
    frontline,
    engage,
    ranged,
    curve: n ? curve / n : 0,
    warnings: [],
  };
  if (n >= 3 && physical >= 0.7) out.warnings.push("Mostly physical damage: one armour item answers it");
  if (n >= 3 && physical <= 0.3) out.warnings.push("Mostly magic damage: one magic-resist item answers it");
  if (n >= 4 && frontline === 0) out.warnings.push("No frontline yet");
  if (n >= 4 && engage === 0) out.warnings.push("No hard engage yet");
  return out;
}

/** What a further pick would add, for the co-pilot: a short reason or null when it changes nothing notable. */
export function fills(current: Composition, info: ChampInfo | undefined, champion: string): string | null {
  if (current.champions < 2) return null;
  if (info && current.physical >= 0.7 && info.magic > info.attack) return "adds magic damage";
  if (info && current.physical <= 0.3 && info.attack > info.magic) return "adds physical damage";
  if (current.champions >= 3 && current.frontline === 0 && info && isFrontline(info)) return "adds a frontline";
  if (current.champions >= 3 && current.engage === 0 && ENGAGE.has(champion)) return "adds engage";
  return null;
}
