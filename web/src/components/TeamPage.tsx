import { motion } from "framer-motion";
import { Ban, Map as MapIcon, PlayCircle, Sparkles, Swords, Target } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchContext, fetchProfile, fetchTendencies } from "../api/client";
import type { DraftTendencyItem, TeamDraftTendencies, TeamProfile, TeamSummary } from "../api/types";
import { splashUrl, useCatalog } from "../lib/ddragon";
import { clock, pct, type PastGame } from "../lib/draft";
import { draftLink, replayLink, teamLink, type TeamTab } from "../lib/route";
import { ChampIcon } from "./ChampIcon";
import { Jungle, Objectives, Tells } from "./Scouting";
import { Tendencies } from "./Tendencies";
import { TeamBadge, TeamSearch, leagueOf } from "./TeamSearch";

const TABS: { id: TeamTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "draft", label: "Draft habits" },
  { id: "map", label: "Map habits" },
  { id: "tells", label: "Tells" },
  { id: "games", label: "Games" },
];

function Fact({ icon, title, value, note, champ }: { icon: ReactNode; title: string; value: string; note: string; champ?: string }) {
  return (
    <motion.article className="fact" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="fact-head">
        {icon}
        <span>{title}</span>
      </div>
      <div className="fact-body">
        {champ && <ChampIcon name={champ} size={52} />}
        <div>
          <div className="fact-value">{value}</div>
          <div className="fact-note">{note}</div>
        </div>
      </div>
    </motion.article>
  );
}

const distinctive = (items: DraftTendencyItem[]) =>
  [...items].filter((t) => t.direction === "above").sort((a, b) => a.q - b.q || b.rate - a.rate)[0];

function ThreeThings({ profile, tendencies }: { profile: TeamProfile | null; tendencies: TeamDraftTendencies | null }) {
  const ban = tendencies ? distinctive(tendencies.bans) : undefined;
  const pick = tendencies ? [...tendencies.picks].sort((a, b) => b.count - a.count)[0] : undefined;
  const jg = profile?.jungle;
  const top = jg?.start_side.top ?? 0;
  const lane = jg ? Object.entries(jg.first_lane).sort((a, b) => b[1] - a[1])[0] : undefined;
  return (
    <section className="facts" aria-label="Three things to know">
      {ban ? (
        <Fact
          icon={<Ban size={16} />}
          title="They ban"
          champ={ban.champion}
          value={`${ban.champion} · ${pct(ban.rate)}`}
          note={`League ${pct(ban.league_rate)} · ${ban.count}/${ban.team_games} games`}
        />
      ) : (
        <div className="fact skeleton" />
      )}
      {pick ? (
        <Fact
          icon={<Target size={16} />}
          title="They lean on"
          champ={pick.champion}
          value={`${pick.champion} · ${pct(pick.rate)}`}
          note={`Picked in ${pick.count} of ${pick.team_games} games`}
        />
      ) : (
        <div className="fact skeleton" />
      )}
      {jg && lane ? (
        <Fact
          icon={<MapIcon size={16} />}
          title="Their jungler"
          value={`Opens ${top >= 0.5 ? "top" : "bot"}-side · ${pct(Math.max(top, 1 - top))}`}
          note={`First seen ${lane[0]} ${pct(lane[1])} · ${jg.games} games`}
        />
      ) : (
        <div className="fact skeleton" />
      )}
    </section>
  );
}

function TopChamps({ title, items }: { title: string; items: DraftTendencyItem[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="champ-strip">
        {items.slice(0, 8).map((t) => (
          <div key={t.champion} className="champ-stat">
            <ChampIcon name={t.champion} size={48} />
            <b>{pct(t.rate)}</b>
            <span>{t.champion}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Games({ games }: { games: PastGame[] | null }) {
  if (!games) return <p className="muted">Loading games…</p>;
  if (!games.length) return <p className="muted">No recent games.</p>;
  return (
    <section className="card">
      <h2>Recent games</h2>
      <div className="game-list">
        {games.map((g) => (
          <a key={g.game_id} className="game-row" href={replayLink(g.game_id)}>
            <span className={`result ${g.won ? "us" : "them"}`}>{g.won ? "W" : "L"}</span>
            <span className="game-vs">
              <span>
                vs <b>{g.opponent}</b>
              </span>
              <small>
                {g.date} · {g.side} side · {clock(g.duration_s)}
              </small>
            </span>
            <span className="game-picks">
              {g.picks.map((p) => (
                <ChampIcon key={p.champion} name={p.champion} size={30} />
              ))}
            </span>
            <span className="watch">
              <PlayCircle size={18} aria-hidden /> Watch
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

interface Props {
  teamId: string | null;
  tab: TeamTab;
  teams: TeamSummary[];
  ours: string | null;
}

export function TeamPage({ teamId, tab, teams, ours }: Props) {
  const catalog = useCatalog();
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [tendencies, setTendencies] = useState<TeamDraftTendencies | null>(null);
  const [games, setGames] = useState<PastGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const team = teams.find((t) => t.team_id === teamId);

  useEffect(() => {
    setProfile(null);
    setTendencies(null);
    setGames(null);
    setError(null);
    if (!teamId) return;
    let alive = true;
    fetchProfile(teamId)
      .then((p) => alive && setProfile(p))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load this team"));
    fetchTendencies(teamId)
      .then((t) => alive && setTendencies(t))
      .catch(() => undefined);
    const other = ours && ours !== teamId ? ours : (teams.find((t) => t.team_id !== teamId)?.team_id ?? "");
    fetchContext(other, teamId)
      .then((c) => alive && setGames(c.opponent_recent))
      .catch(() => alive && setGames([]));
    return () => {
      alive = false;
    };
  }, [teamId, ours, teams]);

  const signature = useMemo(() => (tendencies ? [...tendencies.picks].sort((a, b) => b.count - a.count)[0]?.champion : undefined), [tendencies]);
  const splash = signature ? splashUrl(catalog, signature) : null;

  if (!teamId) {
    return (
      <main className="app narrow">
        <section className="pick-team">
          <h1>Scout a team</h1>
          <p className="muted">Draft habits, map habits and the games behind them.</p>
          <TeamSearch teams={teams} size="lg" autoFocus onSelect={(t) => (window.location.hash = teamLink(t.team_id))} />
        </section>
      </main>
    );
  }

  const name = team?.name ?? profile?.team.name ?? "Team";
  return (
    <main>
      <header className="team-hero" style={splash ? { backgroundImage: `url(${splash})` } : undefined}>
        <div className="team-hero-shade" />
        <div className="app team-hero-inner">
          <TeamBadge team={{ team_id: teamId, name }} size={72} />
          <div className="team-hero-text">
            <span className="eyebrow">{team ? leagueOf(team) : "Team"}</span>
            <h1>{name}</h1>
            <div className="team-hero-meta">
              {team && (
                <>
                  <span>{team.games} games</span>
                  <span>
                    {team.first_seen} → {team.last_seen}
                  </span>
                </>
              )}
              {signature && (
                <span>
                  <Sparkles size={14} aria-hidden /> signature: {signature}
                </span>
              )}
            </div>
          </div>
          <div className="team-hero-actions">
            <a className="btn primary" href={draftLink(ours && ours !== teamId ? ours : null, teamId)}>
              <Swords size={16} aria-hidden /> Draft against them
            </a>
            {games && games[0] && (
              <a className="btn ghost-light" href={replayLink(games[0].game_id)}>
                <PlayCircle size={16} aria-hidden /> Latest game
              </a>
            )}
          </div>
        </div>
        <nav className="app tabs" aria-label="Team sections">
          {TABS.map((t) => (
            <a key={t.id} href={teamLink(teamId, t.id)} aria-current={tab === t.id ? "page" : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>

      <div className="app team-body">
        {error && (
          <p className="card err" role="alert">
            {error}
          </p>
        )}
        {tab === "overview" && (
          <>
            <ThreeThings profile={profile} tendencies={tendencies} />
            {tendencies && (
              <div className="grid2">
                <TopChamps title="Comfort picks" items={[...tendencies.picks].sort((a, b) => b.count - a.count)} />
                <TopChamps title="What they ban" items={[...tendencies.bans].sort((a, b) => b.count - a.count)} />
              </div>
            )}
            <Games games={games ? games.slice(0, 3) : null} />
          </>
        )}
        {tab === "draft" && <Tendencies teamId={teamId} teamName={name} />}
        {tab === "map" && profile && (
          <>
            <Jungle profile={profile} />
            <Objectives objectives={profile.objectives} />
          </>
        )}
        {tab === "tells" && profile && <Tells teamId={teamId} team={name} tells={profile.tells} />}
        {tab === "games" && <Games games={games} />}
        {!profile && !error && tab !== "draft" && tab !== "games" && <p className="muted">Loading…</p>}
      </div>
    </main>
  );
}
