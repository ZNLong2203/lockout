import { useEffect, useState } from "react";
import { fetchTeams, isLive } from "./api/client";
import type { TeamSummary } from "./api/types";
import { DraftRoom } from "./components/DraftRoom";
import type { Matchup } from "./components/MatchupPicker";
import { ReplayPage } from "./components/ReplayPage";
import { Scouting } from "./components/Scouting";
import { CatalogContext, useLoadedCatalog } from "./lib/ddragon";
import { scoutingLink, useRoute } from "./lib/route";

const PAGES = [
  { page: "draft", label: "Draft room", href: "#/draft" },
  { page: "scouting", label: "Scouting", href: scoutingLink() },
  { page: "replay", label: "Replay", href: "#/replay" },
] as const;

// Teams with a full history first: the default matchup is "Cloud9 against whoever has played the most".
function defaultMatchup(teams: TeamSummary[]): Matchup | null {
  const byGames = [...teams].sort((a, b) => b.games - a.games);
  const ours = byGames.find((t) => /cloud9/i.test(t.name)) ?? byGames[0];
  const opponent = byGames.find((t) => t.team_id !== ours?.team_id);
  return ours && opponent ? { ours: ours.team_id, opponent: opponent.team_id } : null;
}

export default function App() {
  const catalog = useLoadedCatalog();
  const route = useRoute();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [matchup, setMatchup] = useState<Matchup>({ ours: "", opponent: "" });
  const [scoutTeam, setScoutTeam] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams()
      .then((all) => {
        setTeams(all);
        const m = defaultMatchup(all);
        if (m && isLive) setMatchup(m);
      })
      .catch(() => setTeams([]));
  }, []);

  // `#/scouting/<team>` wins; otherwise keep the last team looked at, or the opponent of the current matchup.
  const team = route.page === "scouting" && route.team ? route.team : (scoutTeam ?? (isLive ? matchup.opponent || null : "bravo"));
  useEffect(() => {
    if (route.page === "scouting" && route.team) setScoutTeam(route.team);
  }, [route]);

  const ready = !isLive || (matchup.ours !== "" && matchup.opponent !== "");
  return (
    <CatalogContext.Provider value={catalog}>
      <nav className="topnav" aria-label="Pages">
        <div className="app topnav-inner">
          <span className="brand">Lockout</span>
          <ul>
            {PAGES.map((p) => (
              <li key={p.page}>
                <a href={p.href} aria-current={route.page === p.page ? "page" : undefined}>
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div hidden={route.page !== "draft"}>{ready ? <DraftRoom teams={teams} matchup={matchup} onMatchup={setMatchup} /> : <main className="app"><p className="muted">Loading teams…</p></main>}</div>
      {route.page === "scouting" && <Scouting teamId={team} onTeam={(id) => (window.location.hash = scoutingLink(id))} />}
      {route.page === "replay" && <ReplayPage gameId={route.game} startAt={route.t} />}

      <footer className="app legal">
        Lockout isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing
        or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
        Champion portraits, splash art and the minimap behind the 3D terrain are loaded at runtime from Riot's Data Dragon. Match data provided by GRID; not endorsed by Cloud9.
      </footer>
    </CatalogContext.Provider>
  );
}
