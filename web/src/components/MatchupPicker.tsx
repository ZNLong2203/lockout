import { useMemo } from "react";
import type { TeamSummary } from "../api/types";

export interface Matchup {
  ours: string;
  opponent: string;
}

interface Props {
  teams: TeamSummary[];
  value: Matchup;
  onChange: (m: Matchup) => void;
}

/** Choose our team and the opponent (live mode). Teams with fewer than 6 games are listed last and flagged. */
export function MatchupPicker({ teams, value, onChange }: Props) {
  const sorted = useMemo(() => [...teams].sort((a, b) => a.name.localeCompare(b.name)), [teams]);
  const option = (t: TeamSummary) => (
    <option key={t.team_id} value={t.team_id}>
      {t.name} ({t.games} games)
    </option>
  );
  return (
    <section className="card" aria-label="Choose the matchup">
      <div className="inline-form">
        <label>
          Our team
          <select value={value.ours} onChange={(e) => onChange({ ...value, ours: e.target.value })}>
            {sorted.map(option)}
          </select>
        </label>
        <label>
          Opponent
          <select value={value.opponent} onChange={(e) => onChange({ ...value, opponent: e.target.value })}>
            {sorted.filter((t) => t.team_id !== value.ours).map(option)}
          </select>
        </label>
        <span className="muted">Pools come from each team's most recent lineup.</span>
      </div>
    </section>
  );
}
