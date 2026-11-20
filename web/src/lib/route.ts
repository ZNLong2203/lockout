import { useEffect, useState } from "react";

// A tiny hash router: `#/draft`, `#/scouting/<teamId>`, `#/replay/<gameId>?t=<seconds>`.
// Hash routes keep the app a static bundle (no server rewrite rules) and make every view linkable.
export type Route =
  | { page: "draft" }
  | { page: "scouting"; team: string | null }
  | { page: "replay"; game: string | null; t: number };

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [page, arg] = path.split("/").map(decodeURIComponent);
  if (page === "scouting") return { page, team: arg || null };
  if (page === "replay") {
    const t = Number(new URLSearchParams(query).get("t"));
    return { page, game: arg || null, t: Number.isFinite(t) && t > 0 ? t : 0 };
  }
  return { page: "draft" };
}

export const replayLink = (gameId: string, t = 0) => `#/replay/${encodeURIComponent(gameId)}${t > 0 ? `?t=${Math.round(t)}` : ""}`;
export const scoutingLink = (teamId?: string | null) => `#/scouting${teamId ? `/${encodeURIComponent(teamId)}` : ""}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
