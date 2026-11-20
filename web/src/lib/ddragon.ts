// Champion portraits from Riot's Data Dragon CDN, loaded at runtime (never stored in this repository).
// Use is subject to Riot's developer policies; the app shows Riot's required notice in its footer.
import { createContext, useContext, useEffect, useState } from "react";

const BASE = "https://ddragon.leagueoflegends.com";

/** Riot's own champion classification (Data Dragon `champion.json`): class tags and 0-10 ratings. */
export interface ChampInfo {
  tags: string[]; // "Fighter", "Tank", "Mage", "Assassin", "Marksman", "Support"
  attack: number;
  defense: number;
  magic: number;
  range: number; // basic attack range in game units
}

export interface Catalog {
  version: string;
  names: string[]; // display names, sorted
  idByName: Map<string, string>; // lower-case display name -> Data Dragon id ("Wukong" -> "MonkeyKing")
  info: Map<string, ChampInfo>; // lower-case display name -> classification
}

const EMPTY: Catalog = { version: "", names: [], idByName: new Map(), info: new Map() };
let pending: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  pending ??= (async () => {
    const versions = (await (await fetch(`${BASE}/api/versions.json`)).json()) as string[];
    const version = versions[0] ?? "";
    const body = (await (await fetch(`${BASE}/cdn/${version}/data/en_US/champion.json`)).json()) as {
      data: Record<
        string,
        { id: string; name: string; tags?: string[]; info?: { attack: number; defense: number; magic: number }; stats?: { attackrange?: number } }
      >;
    };
    const champs = Object.values(body.data);
    return {
      version,
      names: champs.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      idByName: new Map(champs.map((c) => [c.name.toLowerCase(), c.id])),
      info: new Map(
        champs.map((c) => [
          c.name.toLowerCase(),
          {
            tags: c.tags ?? [],
            attack: c.info?.attack ?? 0,
            defense: c.info?.defense ?? 0,
            magic: c.info?.magic ?? 0,
            range: c.stats?.attackrange ?? 0,
          },
        ]),
      ),
    };
  })().catch(() => EMPTY); // offline: the app falls back to lettered tiles
  return pending;
}

export const CatalogContext = createContext<Catalog>(EMPTY);
export const useCatalog = () => useContext(CatalogContext);

export function useLoadedCatalog(): Catalog {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((c) => alive && setCatalog(c));
    return () => {
      alive = false;
    };
  }, []);
  return catalog;
}

export function iconUrl(catalog: Catalog, name: string): string | null {
  const id = catalog.idByName.get(name.toLowerCase());
  return id && catalog.version ? `${BASE}/cdn/${catalog.version}/img/champion/${id}.png` : null;
}

/** Wide splash art (default skin), for pick banners. Unversioned path on Data Dragon. */
export function splashUrl(catalog: Catalog, name: string): string | null {
  const id = catalog.idByName.get(name.toLowerCase());
  return id ? `${BASE}/cdn/img/champion/splash/${id}_0.jpg` : null;
}

/** Riot's official Summoner's Rift minimap (schematic), used to build the 3D terrain at runtime. */
export function mapUrl(catalog: Catalog): string | null {
  return catalog.version ? `${BASE}/cdn/${catalog.version}/img/map/map11.png` : null;
}

export const infoOf = (catalog: Catalog, name: string): ChampInfo | undefined => catalog.info.get(name.toLowerCase());
