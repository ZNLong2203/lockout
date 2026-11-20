// Champion portraits from Riot's Data Dragon CDN, loaded at runtime (never stored in this repository).
// Use is subject to Riot's developer policies; the app shows Riot's required notice in its footer.
import { createContext, useContext, useEffect, useState } from "react";

const BASE = "https://ddragon.leagueoflegends.com";

export interface Catalog {
  version: string;
  names: string[]; // display names, sorted
  idByName: Map<string, string>; // lower-case display name -> Data Dragon id ("Wukong" -> "MonkeyKing")
}

const EMPTY: Catalog = { version: "", names: [], idByName: new Map() };
let pending: Promise<Catalog> | null = null;

export function loadCatalog(): Promise<Catalog> {
  pending ??= (async () => {
    const versions = (await (await fetch(`${BASE}/api/versions.json`)).json()) as string[];
    const version = versions[0] ?? "";
    const body = (await (await fetch(`${BASE}/cdn/${version}/data/en_US/champion.json`)).json()) as {
      data: Record<string, { id: string; name: string }>;
    };
    const champs = Object.values(body.data);
    return {
      version,
      names: champs.map((c) => c.name).sort((a, b) => a.localeCompare(b)),
      idByName: new Map(champs.map((c) => [c.name.toLowerCase(), c.id])),
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
