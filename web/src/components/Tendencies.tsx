import { useEffect, useState } from "react";
import { fetchTendencies } from "../api/client";
import type { BanTarget, DraftTendencyItem, TeamDraftTendencies, TendencyScope } from "../api/types";
import { pct } from "../lib/draft";
import { ChampIcon, ROLE_SHORT } from "./ChampIcon";
import { LineChart } from "./LineChart";

const SCOPES: [TendencyScope, string][] = [
  ["all", "All games"],
  ["g1", "Game 1 only"],
  ["later", "Games 2+"],
];

function Row({ item, mark }: { item: DraftTendencyItem; mark: "above" | "below" }) {
  return (
    <li className="tend">
      <ChampIcon name={item.champion} size={36} />
      <div>
        <b>{item.champion}</b>{" "}
        <span className={`strength ${item.strength}`}>{item.strength === "typical" ? "Typical" : item.strength === "strong" ? "Strong" : "Suggestive"}</span>
        <div className="muted">
          {item.count}/{item.team_games} games ({pct(item.rate)}) · league {pct(item.league_rate)} · {mark === "above" ? "more often than" : "less often than"} the league · q ={" "}
          {item.q < 0.001 ? "<0.001" : item.q.toFixed(3)}
        </div>
      </div>
    </li>
  );
}

function Targets({ targets }: { targets: BanTarget[] }) {
  if (!targets.length) return null;
  const n = targets[0]?.n ?? 0;
  return (
    <div>
      <h3 className="h3">What their bans aim at</h3>
      <p className="sub">Share of their bans by the role the banned champion is usually played in (n = {n} bans), against the league.</p>
      <ul className="targets">
        {targets.map((t) => (
          <li key={t.role}>
            <span className="role-tag">{ROLE_SHORT[t.role]}</span>
            <div className="target-bars" role="img" aria-label={`${t.role}: ${pct(t.team_share)} of their bans, league ${pct(t.league_share)}`}>
              <div className="meter" style={{ ["--c" as string]: "var(--side-them)" }}>
                <span style={{ width: `${t.team_share * 100}%` }} />
              </div>
              <div className="meter" style={{ ["--c" as string]: "var(--muted)" }}>
                <span style={{ width: `${t.league_share * 100}%` }} />
              </div>
            </div>
            <span className="muted">
              {pct(t.team_share)} <span aria-hidden>vs</span> {pct(t.league_share)}
            </span>
          </li>
        ))}
      </ul>
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--side-them)" }}>
          <i /> This team
        </span>
        <span style={{ ["--c" as string]: "var(--muted)" }}>
          <i /> League
        </span>
      </div>
    </div>
  );
}

/** What repeats in a team's drafts, and how its picks shift as a Fearless series goes on. */
export function Tendencies({ teamId, teamName }: { teamId: string; teamName: string }) {
  const [scope, setScope] = useState<TendencyScope>("all");
  const [data, setData] = useState<TeamDraftTendencies | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    let alive = true;
    fetchTendencies(teamId, scope)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the tendencies"));
    return () => {
      alive = false;
    };
  }, [teamId, scope]);

  const shift = data?.fearless_shift ?? [];
  return (
    <>
      <section className="card" aria-label={`${teamName} pick and ban tendencies`}>
        <h2>{teamName}: pick and ban tendencies</h2>
        <p className="sub">
          Compared with the whole league in the same games. A champion only counts as a habit when it is both frequent and unusual
          (exact test, corrected for the number of champions looked at).
        </p>
        <div className="chips" role="group" aria-label="Which games">
          {SCOPES.map(([id, label]) => (
            <button key={id} type="button" className={`chip ${scope === id ? "on" : ""}`} aria-pressed={scope === id} onClick={() => setScope(id)}>
              {label}
            </button>
          ))}
        </div>
        {error && <p className="muted" role="status">{error}</p>}
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <>
            <p className="muted">n = {data.team_games} games</p>
            <div className="grid2">
              <div>
                <h3 className="h3">Bans they keep making</h3>
                <ul className="tend-list">
                  {data.bans.map((b) => (
                    <Row key={b.champion} item={b} mark={b.direction} />
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="h3">Picks they favour</h3>
                <ul className="tend-list">
                  {data.picks.map((p) => (
                    <Row key={p.champion} item={p} mark={p.direction} />
                  ))}
                </ul>
              </div>
            </div>
            <Targets targets={data.ban_targets} />
            <ul className="clean" style={{ marginTop: 12 }}>
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      {shift.length > 0 && (
        <LineChart
          title={`${teamName}: how their draft shifts as the series goes on`}
          subtitle="Share of picks from a player's top 3 champions, by game number. n = picks with a trusted pool, shown under each game."
          xLabels={shift.map((d) => `G${d.game_number} (n=${d.picks})`)}
          yMax={0.5}
          series={[
            { id: "team", label: teamName, color: "var(--series-2)", values: shift.map((d) => d.share_top3) },
            { id: "league", label: "League", color: "var(--series-1)", values: shift.map((d) => d.league_share_top3) },
          ]}
          ariaLabel={`Share of ${teamName}'s picks from a player's top three champions by game number, against the league`}
        />
      )}
    </>
  );
}
