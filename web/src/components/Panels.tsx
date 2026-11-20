import type { BanSuggestion, DraftBacktest, JungleBridge } from "../api/types";
import { LineChart } from "./LineChart";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function BanPlan({ theirs, ours }: { theirs: BanSuggestion[]; ours: BanSuggestion[] }) {
  return (
    <section className="grid2">
      <div className="card">
        <h2>Bans that bite</h2>
        <p className="sub">Champions whose removal takes the biggest share of what their most fragile roles have left.</p>
        <table>
          <tbody>
            {theirs.map((b) => (
              <tr key={`${b.role}-${b.champion}`}>
                <td>
                  <b>{b.champion}</b> <span className="muted">{b.role}</span>
                </td>
                <td className="num">{pct(b.share_of_remaining)} of what is left</td>
              </tr>
            ))}
            {theirs.length === 0 && (
              <tr>
                <td className="muted">Not enough history to suggest bans.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Save for later (our pool)</h2>
        <p className="sub">Our biggest remaining chunks in our most fragile roles. Spending them early is what hurts by game 3 or 4.</p>
        <table>
          <tbody>
            {ours.map((b) => (
              <tr key={`${b.role}-${b.champion}`}>
                <td>
                  <b>{b.champion}</b> <span className="muted">{b.role}</span>
                </td>
                <td className="num">{pct(b.share_of_remaining)} of what is left</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function BridgeCard({ bridges, teamName }: { bridges: JungleBridge[]; teamName: string }) {
  return (
    <section className="card" aria-label="Macro bridge">
      <h2>If {teamName} plays one of its remaining junglers</h2>
      <p className="sub">How that jungler has opened and where they appear first, from player trajectories.</p>
      {bridges.length === 0 && <p className="muted">No jungle champions left with history.</p>}
      {bridges.map((b) => (
        <div className="bridge" key={b.champion}>
          <b>{b.champion}</b> <span className="muted">{b.scope === "team" ? "this team" : "league-wide"} · n = {b.n}</span>
          <div>
            Opens top-side {pct(b.start_top)} / bot-side {pct(b.start_bot)}. First lane seen: top {pct(b.first_lane.top ?? 0)}, mid{" "}
            {pct(b.first_lane.mid ?? 0)}, bot {pct(b.first_lane.bot ?? 0)}
            {b.median_first_lane_t !== null && <>, around {Math.floor(b.median_first_lane_t / 60)}:{String(b.median_first_lane_t % 60).padStart(2, "0")}</>}.
          </div>
          {b.n < 10 && <div className="muted">Small sample: treat as a hint, not a rule.</div>}
        </div>
      ))}
    </section>
  );
}

export function TrustPanel({ data }: { data: DraftBacktest }) {
  const p = data.pairwise;
  const critical = data.buckets[0];
  const first = data.depletion[0];
  const last = data.depletion[data.depletion.length - 1];
  return (
    <section aria-label="How far to trust this">
      <div className="card">
        <h2>How far can you trust this?</h2>
        <p className="sub">Back-tested on every Fearless series in the corpus, using only what was known before each game.</p>
        <div className="grid3" style={{ marginTop: 12 }}>
          <div className="tile">
            <div className="value">
              {first ? pct(first.mean_stress) : "–"}→{last ? pct(last.mean_stress) : "–"}
            </div>
            <div className="label">
              Pool the weakest role has left, game {first?.game_number ?? "?"} → game {last?.game_number ?? "?"}
            </div>
            <div className="note">Solid: it falls every game.</div>
          </div>
          <div className="tile">
            <div className="value">{(p.rate * 100).toFixed(1)}%</div>
            <div className="label">Wins by the lineup with the more comfortable pool</div>
            <div className="note">
              n = {p.n}, 95% CI {pct(p.ci_lo)}–{pct(p.ci_hi)}, p = {p.p_value.toFixed(3)}. Modest and exploratory.
            </div>
          </div>
          <div className="tile">
            <div className="value">{critical ? pct(critical.win_rate) : "–"}</div>
            <div className="label">Win rate with a critical pool, across games</div>
            <div className="note">
              {critical && `n = ${critical.n}, CI ${pct(critical.ci_lo)}–${pct(critical.ci_hi)}: not shown to differ from 50%.`}
            </div>
          </div>
        </div>
        <ul className="clean" style={{ marginTop: 12 }}>
          {data.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <div className="grid2">
        <LineChart
          title="Pool left by game (league)"
          subtitle="Mean share of the weakest role's pool still available, team-games with a trusted pool."
          xLabels={data.depletion.map((d) => `G${d.game_number}`)}
          series={[{ id: "dep", label: "Weakest role", color: "var(--series-1)", values: data.depletion.map((d) => d.mean_stress) }]}
          ariaLabel="Mean share of the weakest role's pool left, by game number"
        />
        <LineChart
          title="Reaching deeper as the series goes on"
          subtitle="Share of picks from a player's top 3 champions, and of champions they have never played."
          xLabels={data.pick_depth.map((d) => `G${d.game_number}`)}
          yMax={0.5}
          series={[
            { id: "top3", label: "From their top 3", color: "var(--series-1)", values: data.pick_depth.map((d) => d.share_top3) },
            { id: "new", label: "Never played before", color: "var(--series-2)", values: data.pick_depth.map((d) => d.share_new) },
          ]}
          ariaLabel="Share of picks from the top three champions and of new champions, by game number"
        />
      </div>
    </section>
  );
}
