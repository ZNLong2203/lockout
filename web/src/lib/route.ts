import { useEffect, useState } from "react";

// A tiny hash router. Hash routes keep the app a static bundle (no server rewrites) and make every view linkable.
//   #/                      home: search a team
//   #/team/<id>[?tab=...]   a team's page (old #/scouting/<id> links still work)
//   #/draft[?us=..&vs=..]   the Fearless draft room
//   #/replay/<id>[?t=..]    a game replay
export type TeamTab = "overview" | "draft" | "map" | "tells" | "games";
export const TEAM_TABS: TeamTab[] = ["overview", "draft", "map", "tells", "games"];

export type Route =
  | { page: "home" }
  | { page: "team"; team: string | null; tab: TeamTab }
  | { page: "draft"; us: string | null; vs: string | null }
  | { page: "replay"; game: string | null; t: number };

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  const q = new URLSearchParams(query);
  const [page, arg] = path.split("/").map(decodeURIComponent);
  if (page === "team" || page === "scouting") {
    const tab = q.get("tab") as TeamTab | null;
    return { page: "team", team: arg || null, tab: tab && TEAM_TABS.includes(tab) ? tab : "overview" };
  }
  if (page === "draft") return { page: "draft", us: q.get("us") || null, vs: q.get("vs") || null };
  if (page === "replay") {
    const t = Number(q.get("t"));
    return { page, game: arg || null, t: Number.isFinite(t) && t > 0 ? t : 0 };
  }
  return { page: "home" };
}

export const replayLink = (gameId: string, t = 0) => `#/replay/${encodeURIComponent(gameId)}${t > 0 ? `?t=${Math.round(t)}` : ""}`;
export const teamLink = (teamId?: string | null, tab: TeamTab = "overview") =>
  `#/team${teamId ? `/${encodeURIComponent(teamId)}` : ""}${tab !== "overview" ? `?tab=${tab}` : ""}`;
/** Kept for links created before the team page existed. */
export const scoutingLink = (teamId?: string | null) => teamLink(teamId);
export const draftLink = (us?: string | null, vs?: string | null) => {
  const q = new URLSearchParams();
  if (us) q.set("us", us);
  if (vs) q.set("vs", vs);
  const s = q.toString();
  return `#/draft${s ? `?${s}` : ""}`;
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
