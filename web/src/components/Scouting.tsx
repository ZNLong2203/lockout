import { useEffect, useMemo, useState } from "react";
import { fetchProfile, fetchTeams, isLive } from "../api/client";
import type { ObjectiveProfile, TeamProfile, TeamSummary, Tell } from "../api/types";
import { clock, pct } from "../lib/draft";
import { replayLink } from "../lib/route";
import { EvidenceList } from "./EvidenceList";
import { RateBar } from "./RateBar";

const STRENGTH_WORD: Record<Tell["strength"], string> = {
  strong: "Strong",
  suggestive: "Suggestive",
  typical: "Typical",
};
const OBJECTIVE_WORD: Record<ObjectiveProfile["objective"], string> = { dragon: "Dragon", baron: "Baron", herald: "Rift Herald", grubs: "Void grubs" };
const STRENGTH_RANK: Record<Tell["strength"], number> = { strong: 0, suggestive: 1, typical: 2 };

// The API refuses a profile below this many games (docs/api-contract.md).
const MIN_GAMES = 6;

const routeWords = (route: string) => route.split(">").map((c) => c.replace(/_/g, " "));

function Tells({ teamId, team, tells }: { teamId: string; team: string; tells: Tell[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = useMemo(() => [...tells].sort((a, b) => STRENGTH_RANK[a.strength] - STRENGTH_RANK[b.strength] || a.q - b.q), [tells]);
  const notable = sorted.filter((t) => t.strength !== "typical").length;
  return (
    <section className="card" aria-label="Tells">
      <h2>Tells: what {team} does in a given situation</h2>
      <p className="sub">
        Each tell is tested against the league and corrected for the number of comparisons (Benjamini-Hochberg). {notable} of {tells.length} stand out; the rest
        look like everyone else, and we say so.
      </p>
      <ul className="tells">
        {sorted.map((t) => (
          <li key={t.template_id} className={`tell ${t.strength}`}>
            <div className="tell-head">
              <span className={`strength ${t.strength}`}>{STRENGTH_WORD[t.strength]}</span>
              <b>
                {team}: {t.title}
              </b>
              <span className="muted">{t.group}</span>
            </div>
            <RateBar rate={t.rate} label={t.title} />
            <div className="tell-foot">
              <span className="muted">
                n = {t.rate.n} · q = {t.q < 0.001 ? "<0.001" : t.q.toFixed(3)} · shrunk rate {pct(t.shrunk_rate)} · {t.direction} the league
              </span>
              <button type="button" className="ghost" aria-expanded={open === t.template_id} onClick={() => setOpen(open === t.template_id ? null : t.template_id)}>
                {open === t.template_id ? "Hide games" : `Show the ${t.rate.n} games`}
              </button>
            </div>
            {open === t.template_id && <EvidenceList teamId={teamId} templateId={t.template_id} />}
          </li>
        ))}
        {sorted.length === 0 && <li className="muted">No situation came up often enough (6+ times) to be tested.</li>}
      </ul>
    </section>
  );
}

function Jungle({ profile }: { profile: TeamProfile }) {
  const j = profile.jungle;
  if (!j) return null;
  return (
    <section className="card" aria-label="Jungle openings">
      <h2>How their jungler opens</h2>
      <p className="sub">First three camps in order of first detected contact, from player positions. n = {j.games} games.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Opening</th>
            <th scope="col">Share</th>
            <th scope="col" className="num">n</th>
            <th scope="col">Example games</th>
          </tr>
        </thead>
        <tbody>
          {j.routes.map((r) => (
            <tr key={r.route}>
              <td>{routeWords(r.route).join(" → ")}</td>
              <td>
                <div className="bar-cell">
                  <div className="meter" style={{ ["--c" as string]: "var(--series-1)" }} aria-hidden>
                    <span style={{ width: `${r.share * 100}%` }} />
                  </div>
                  <span>{pct(r.share)}</span>
                </div>
              </td>
              <td className="num">{r.n}</td>
              <td>
                {r.example_game_ids.map((g) => (
                  <a key={g} className="game-link" href={replayLink(g, 60)}>
                    {g}
                  </a>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid3 jungle-stats">
        <div className="tile">
          <div className="value">{pct(j.start_side.top ?? 0)}</div>
          <div className="label">start top-side (bot-side {pct(j.start_side.bot ?? 0)})</div>
        </div>
        {(["top", "mid", "bot"] as const).map((lane) => (
          <div className="tile" key={lane}>
            <div className="value">{pct(j.first_lane[lane] ?? 0)}</div>
            <div className="label">
              first seen in {lane}
              {j.median_first_lane_t[lane] != null && `, median ${clock(j.median_first_lane_t[lane] as number)}`}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Objectives({ objectives }: { objectives: ObjectiveProfile[] }) {
  if (!objectives.length) return null;
  return (
    <section className="card" aria-label="Objective set-up">
      <h2>How they set up for objectives</h2>
      <p className="sub">Living players within range 30 seconds before the objective falls, against the league, and how often they win it when set up early.</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Objective</th>
            <th scope="col" className="num">Taken (n)</th>
            <th scope="col" className="num">Players at −30 s</th>
            <th scope="col" className="num">League</th>
            <th scope="col" className="num">Median set-up</th>
            <th scope="col">Secured when 3+ players in place at spawn</th>
          </tr>
        </thead>
        <tbody>
          {objectives.map((o) => (
            <tr key={o.objective}>
              <th scope="row">{OBJECTIVE_WORD[o.objective]}</th>
              <td className="num">{o.taken}</td>
              <td className="num">{o.mean_players_m30_when_taken.toFixed(1)}</td>
              <td className="num">{o.league_mean_players_m30.toFixed(1)}</td>
              <td className="num">{Math.round(o.median_setup_s)} s</td>
              <td>{o.prepositioned_secure ? <RateBar rate={o.prepositioned_secure} label={`${OBJECTIVE_WORD[o.objective]} secured when set up`} /> : <span className="muted">not enough cases</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

interface Props {
  teamId: string | null;
  onTeam: (teamId: string) => void;
}

/** A team's macro profile: jungle openings, objective set-up and the tells that stand out, each with its evidence. */
export function Scouting({ teamId, onTeam }: Props) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [event, setEvent] = useState<string | null>(null);
  const [profile, setProfile] = useState<TeamProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTeams()
      .then(setTeams)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load the teams"));
  }, []);

  useEffect(() => {
    setEvent(null);
  }, [teamId]);

  useEffect(() => {
    setProfile(null);
    setError(null);
    if (!teamId) return;
    let alive = true;
    fetchProfile(teamId, event)
      .then((p) => alive && setProfile(p))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the profile"));
    return () => {
      alive = false;
    };
  }, [teamId, event]);

  const current = teams.find((t) => t.team_id === teamId);
  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);

  return (
    <main className="app">
      <section className="card" aria-label="Choose a team">
        <h2>Scouting</h2>
        <p className="sub">The macro behaviour behind the draft: how a team opens in the jungle, how it sets up for objectives, and what it does in recurring situations.</p>
        <div className="inline-form">
          <label>
            Team
            <select value={teamId ?? ""} onChange={(e) => e.target.value && onTeam(e.target.value)}>
              <option value="">Choose a team…</option>
              {sorted.map((t) => (
                <option key={t.team_id} value={t.team_id}>
                  {t.name} ({t.games} games{t.games < MIN_GAMES ? ", too few for a profile" : ""})
                </option>
              ))}
            </select>
          </label>
          {current && current.events.length > 1 && (
            <label>
              Event
              <select value={event ?? ""} onChange={(e) => setEvent(e.target.value || null)}>
                <option value="">All events</option>
                {current.events.map((ev) => (
                  <option key={ev} value={ev}>
                    {ev}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!isLive && <span className="badge demo">Demo: synthetic teams and numbers</span>}
        </div>
      </section>

      {!teamId && <p className="muted">Pick a team to see its profile.</p>}
      {teamId && !profile && !error && <p className="muted">Loading the profile…</p>}
      {error && (
        <p className="card err" role="alert">
          {error}
        </p>
      )}
      {profile && (
        <>
          <section className="card" aria-label="Team summary">
            <h2>{profile.team.name}</h2>
            <p className="sub">
              {profile.team.games} games from {profile.team.first_seen} to {profile.team.last_seen}
              {event ? `, restricted to ${event}` : ""}.
            </p>
          </section>
          <Jungle profile={profile} />
          <Objectives objectives={profile.objectives} />
          <Tells teamId={profile.team.team_id} team={profile.team.name} tells={profile.tells} />
          {profile.notes.length > 0 && (
            <section className="card" aria-label="Caveats">
              <h2>Read this with</h2>
              <ul className="clean">
                {profile.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
