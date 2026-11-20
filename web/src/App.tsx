import { useCallback, useEffect, useState } from "react";
import { fetchBacktest, fetchPlan, isLive } from "./api/client";
import type { DraftBacktest, PlanQuery, RolePool, SeriesPlanResponse } from "./api/types";
import { LineChart } from "./components/LineChart";
import { BanPlan, BridgeCard, TrustPanel } from "./components/Panels";
import { PoolRunwayCard } from "./components/PoolRunwayCard";

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function WeakestTile({ label, role, who }: { label: string; role: RolePool | undefined; who: string }) {
  // With nothing locked every role has 100% left and "weakest" would be an arbitrary pick.
  const untouched = role !== undefined && role.mass >= 0.999;
  return (
    <div className="card tile">
      <div className="label">{label}</div>
      <div className="value">{!role ? "–" : untouched ? "Nothing locked yet" : `${role.role} · ${pct(role.mass)}`}</div>
      <div className="note">
        {who}
        {role && !untouched && ` · ${role.status}, based on ${role.history} picks`}
        {untouched && " · add the champions picked in earlier games to see which role runs out first"}
      </div>
    </div>
  );
}

const DEMO_LOCKED = "Kalista, Rumble, Azir, Wukong, Nautilus, Ashe";

export default function App() {
  const [form, setForm] = useState({
    team: isLive ? "" : "Demo Team A",
    opponent: isLive ? "" : "Demo Team B",
    locked: isLive ? "" : DEMO_LOCKED,
    banned: "",
  });
  const [plan, setPlan] = useState<SeriesPlanResponse | null>(null);
  const [backtest, setBacktest] = useState<DraftBacktest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (f: typeof form) => {
    setBusy(true);
    setError(null);
    const q: PlanQuery = { team: f.team, opponent: f.opponent, locked: split(f.locked), banned: split(f.banned) };
    try {
      setPlan(await fetchPlan(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run(form);
    fetchBacktest().then(setBacktest).catch(() => setBacktest(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const forecast = plan?.forecast ?? null;
  const games = forecast?.[0]?.mean_stress.length ?? 0;

  return (
    <main className="app">
      <div className="top">
        <div>
          <h1>Fearless series planner</h1>
          <p className="sub">
            Which role runs out of champions first, what a ban would take away, and what that pick means on the map.
          </p>
        </div>
        <span className={`badge ${isLive ? "" : "demo"}`}>{isLive ? "Live data" : "Synthetic demo data"}</span>
      </div>

      <form
        className="card controls"
        onSubmit={(e) => {
          e.preventDefault();
          void run(form);
        }}
      >
        <label>
          Our team
          <input value={form.team} onChange={set("team")} />
        </label>
        <label>
          Opponent
          <input value={form.opponent} onChange={set("opponent")} />
        </label>
        <label>
          Locked (earlier games)
          <input value={form.locked} onChange={set("locked")} placeholder="Kalista, Rumble, Azir" />
        </label>
        <label>
          Banned (this draft)
          <input value={form.banned} onChange={set("banned")} placeholder="Wukong" />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Planning…" : "Plan series"}
        </button>
      </form>

      {error && <p className="err" role="alert">{error}</p>}

      {plan && (
        <>
          <div className="grid2">
            <WeakestTile label="Their weakest role right now" role={plan.opponent.roles[0]} who={plan.opponent.name} />
            <WeakestTile label="Our weakest role right now" role={plan.ours.roles[0]} who={plan.ours.name} />
          </div>

          <div className="grid2">
            <PoolRunwayCard team={plan.opponent} accent="var(--series-2)" title="opponent" />
            <PoolRunwayCard team={plan.ours} accent="var(--series-1)" title="us" />
          </div>

          <BanPlan theirs={plan.opponent.ban_suggestions} ours={plan.ours.ban_suggestions} />

          {forecast && games > 0 && (
            <LineChart
              title="Series forecast"
              subtitle={`Mean share of the weakest role's pool left at the start of each game, ${plan.n_sims} simulated series from a fresh start.`}
              xLabels={Array.from({ length: games }, (_, i) => `G${i + 1}`)}
              series={forecast.map((f, i) => ({
                id: f.team_id,
                label: i === 0 ? plan.ours.name : plan.opponent.name,
                color: i === 0 ? "var(--series-1)" : "var(--series-2)",
                values: f.mean_stress,
              }))}
              ariaLabel="Forecast of the weakest role's pool left by game for both teams"
            />
          )}

          <BridgeCard bridges={plan.jungle_bridges} teamName={plan.opponent.name} />

          {plan.notes.length > 0 && (
            <ul className="clean">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {backtest && <TrustPanel data={backtest} />}
    </main>
  );
}
