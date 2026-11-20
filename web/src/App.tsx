import { PlayCircle, Radar, Search, Swords } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchTeams, isLive } from "./api/client";
import type { TeamSummary } from "./api/types";
import { CommandPalette } from "./components/CommandPalette";
import { DraftRoom } from "./components/DraftRoom";
import { Home } from "./components/Home";
import type { Matchup } from "./components/MatchupPicker";
import { ReplayPage } from "./components/ReplayPage";
import { TeamPage } from "./components/TeamPage";
import { CatalogContext, useLoadedCatalog } from "./lib/ddragon";
import { draftLink, teamLink, useRoute } from "./lib/route";

// "Us" defaults to Cloud9 (the tool is built for its coaches), the opponent to the team with the most games.
function defaultMatchup(teams: TeamSummary[]): Matchup | null {
  const byGames = [...teams].sort((a, b) => b.games - a.games);
  const ours = byGames.find((t) => /cloud9/i.test(t.name)) ?? byGames[0];
  const opponent = byGames.find((t) => t.team_id !== ours?.team_id);
  return ours && opponent ? { ours: ours.team_id, opponent: opponent.team_id } : null;
}

const NAV = [
  { page: "draft", label: "Draft room", icon: Swords, href: draftLink() },
  { page: "team", label: "Teams", icon: Radar, href: teamLink() },
  { page: "replay", label: "Replay", icon: PlayCircle, href: "#/replay" },
] as const;

export default function App() {
  const catalog = useLoadedCatalog();
  const route = useRoute();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [matchup, setMatchup] = useState<Matchup>({ ours: "", opponent: "" });

  useEffect(() => {
    fetchTeams()
      .then((raw) => {
        // Bracket placeholders ("TBD-1") are not real teams.
        const all = raw.filter((t) => !/^tbd\b/i.test(t.name.trim()));
        setTeams(all);
        const m = isLive ? defaultMatchup(all) : { ours: "alpha", opponent: "bravo" };
        if (m) setMatchup((cur) => (cur.ours && cur.opponent ? cur : m));
      })
      .catch(() => setTeams([]));
  }, []);

  // A draft link (#/draft?us=..&vs=..) sets the matchup; the room stays mounted so a draft in progress survives navigation.
  useEffect(() => {
    if (route.page === "draft" && (route.us || route.vs)) {
      setMatchup((m) => ({ ours: route.us ?? m.ours, opponent: route.vs ?? m.opponent }));
    }
  }, [route]);

  const onMatchup = (m: Matchup) => {
    setMatchup(m);
    window.history.replaceState(null, "", draftLink(m.ours, m.opponent));
  };
  const ours = matchup.ours || null;
  const ready = matchup.ours !== "" && matchup.opponent !== "";

  return (
    <CatalogContext.Provider value={catalog}>
      <nav className="topnav" aria-label="Pages">
        <div className="app topnav-inner">
          <a className="logo" href="#/">
            <span className="logo-mark" aria-hidden>
              L
            </span>
            Lockout
          </a>
          <ul>
            {NAV.map(({ page, label, icon: Icon, href }) => (
              <li key={page}>
                <a href={href} aria-current={route.page === page ? "page" : undefined}>
                  <Icon size={16} aria-hidden />
                  {label}
                </a>
              </li>
            ))}
          </ul>
          <button type="button" className="search-trigger" onClick={() => window.dispatchEvent(new Event("lockout:search"))}>
            <Search size={15} aria-hidden />
            <span>Search teams</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </nav>
      <CommandPalette teams={teams} ours={ours} />

      {route.page === "home" && <Home teams={teams} ours={ours} />}
      <div hidden={route.page !== "draft"}>
        {ready ? <DraftRoom teams={teams} matchup={matchup} onMatchup={onMatchup} /> : <main className="app"><p className="muted">Loading teams…</p></main>}
      </div>
      {route.page === "team" && <TeamPage teamId={route.team} tab={route.tab} teams={teams} ours={ours} />}
      {route.page === "replay" && <ReplayPage gameId={route.game} startAt={route.t} teams={teams} ours={ours} />}

      <footer className="app legal">
        Lockout isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing
        or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
        Champion portraits, splash art and the minimap behind the 3D terrain are loaded at runtime from Riot's Data Dragon. Match data provided by GRID; not endorsed by Cloud9.
      </footer>
    </CatalogContext.Provider>
  );
}
