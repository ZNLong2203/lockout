import { CalendarDays, Clock3, ExternalLink, Trophy } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchContext, fetchReplay, isLive, isStatic } from "../api/client";
import type { Replay, TeamSummary } from "../api/types";
import { clock, type PastGame } from "../lib/draft";
import { ReplayPlayer } from "./ReplayPlayer";
import { GameList } from "./TeamPage";
import { TeamBadge, TeamSearch } from "./TeamSearch";

function GamePicker({ teams, ours }: { teams: TeamSummary[]; ours: string | null }) {
  const [team, setTeam] = useState<TeamSummary | null>(null);
  const [games, setGames] = useState<PastGame[] | null>(null);
  useEffect(() => {
    if (!team) return;
    setGames(null);
    let alive = true;
    const other = ours && ours !== team.team_id ? ours : (teams.find((t) => t.team_id !== team.team_id)?.team_id ?? "");
    fetchContext(other, team.team_id)
      .then((c) => alive && setGames(c.opponent_recent))
      .catch(() => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, [team, ours, teams]);
  return (
    <section className="pick-team">
      <h1>Watch a game</h1>
      <p className="muted">Pick a team, then one of its recent games. Every player, once per second, on a 3D Rift.</p>
      <TeamSearch teams={teams} size="lg" autoFocus onSelect={setTeam} placeholder="Search a team…" />
      {team && (
        <div className="picker-games">
          <h2>
            <TeamBadge team={team} size={26} /> {team.name}
          </h2>
          <GameList games={games} />
        </div>
      )}
    </section>
  );
}

function MatchBanner({ replay }: { replay: Replay }) {
  const vod = [replay.blue_team, "vs", replay.red_team, replay.event ?? "", replay.started_at?.slice(0, 10) ?? "", replay.game_number ? `game ${replay.game_number}` : ""]
    .filter(Boolean)
    .join(" ");
  const winner = replay.winner_side === "blue" ? replay.blue_team : replay.winner_side === "red" ? replay.red_team : null;
  return (
    <header className="match-banner">
      <div className="mb-teams">
        <span className="mb-team blue">
          <TeamBadge team={{ team_id: `${replay.blue_team}-b`, name: replay.blue_team }} size={34} />
          {replay.blue_team}
        </span>
        <span className="mb-vs">vs</span>
        <span className="mb-team red">
          {replay.red_team}
          <TeamBadge team={{ team_id: `${replay.red_team}-r`, name: replay.red_team }} size={34} />
        </span>
      </div>
      <div className="mb-meta">
        {replay.event && <span>{replay.event}</span>}
        {replay.started_at && (
          <span>
            <CalendarDays size={14} aria-hidden /> {replay.started_at.slice(0, 10)}
          </span>
        )}
        {replay.game_number && <span>Game {replay.game_number}</span>}
        <span>
          <Clock3 size={14} aria-hidden /> {clock(replay.duration_s)}
        </span>
        {winner && (
          <span>
            <Trophy size={14} aria-hidden /> {winner}
          </span>
        )}
        {isStatic && <span className="sim-note" title="Teams, players, champions and the winner are real (Leaguepedia). Positions, kills and objectives are simulated: only the licensed GRID data has them, and it stays local.">Simulated replay · real teams and champions</span>}
        {isLive && !isStatic && (
          <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(vod)}`} target="_blank" rel="noreferrer noopener">
            Find the broadcast <ExternalLink size={13} aria-hidden />
          </a>
        )}
        <a href="#/replay">Change game</a>
      </div>
    </header>
  );
}

/** Pick a game, then watch it: 3D or 2D, live score, players, key moments. */
export function ReplayPage({ gameId, startAt, teams, ours }: { gameId: string | null; startAt: number; teams: TeamSummary[]; ours: string | null }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReplay(null);
    setError(null);
    if (!gameId) return;
    let alive = true;
    fetchReplay(gameId)
      .then((r) => alive && setReplay(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the replay"));
    return () => {
      alive = false;
    };
  }, [gameId]);

  if (!gameId)
    return (
      <main className="app narrow">
        <GamePicker teams={teams} ours={ours} />
      </main>
    );
  return (
    <main className="app">
      {!replay && !error && <p className="muted">Loading the replay…</p>}
      {error && (
        <p className="card err" role="alert">
          {error}
        </p>
      )}
      {replay && (
        <>
          <MatchBanner replay={replay} />
          <section className="card replay-card" aria-label={`Game ${replay.game_id}`}>
            <ReplayPlayer replay={replay} startAt={startAt} />
          </section>
        </>
      )}
    </main>
  );
}
