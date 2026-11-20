import type { PoolStatus } from "../api/types";
import { pct, type RoleState } from "../lib/draft";
import { ChampIcon, ROLE_SHORT, type ChampState } from "./ChampIcon";

const WORD: Record<PoolStatus, string> = { ok: "Comfortable", thin: "Getting thin", critical: "Critical" };

function StatusIcon({ status }: { status: PoolStatus }) {
  const p = { width: 13, height: 13, viewBox: "0 0 14 14", "aria-hidden": true } as const;
  if (status === "ok") return <svg {...p}><path d="M2 7.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (status === "thin") return <svg {...p}><path d="M7 1.5l6 10.5H1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  return <svg {...p}><path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
}

interface Props {
  title: string;
  accent: string;
  states: RoleState[];
  locked: Set<string>;
  bannedNow: Set<string>;
  usedNow: Set<string>;
}

/** One card per player: how much of their comfortable pool is still available, champion by champion. */
export function PlayerPools({ title, accent, states, locked, bannedNow, usedNow }: Props) {
  const byRole = [...states].sort((a, b) => ["top", "jungle", "mid", "adc", "support"].indexOf(a.player.role) - ["top", "jungle", "mid", "adc", "support"].indexOf(b.player.role));
  const stateOf = (c: string): ChampState => (locked.has(c) ? "locked" : bannedNow.has(c) ? "banned" : usedNow.has(c) ? "used" : undefined);
  return (
    <section className="card" aria-label={title}>
      <h2>
        <span className="side-dot" style={{ background: accent }} aria-hidden /> {title}
      </h2>
      <p className="sub">Comfort picks left = share of each player's usual champions (weighted by recent games) still available.</p>
      <div className="players">
        {byRole.map((s) => (
          <article key={s.player.player_id} className={`player s-${s.status}`}>
            <header>
              <span className="role-tag">{ROLE_SHORT[s.player.role]}</span>
              <b>{s.player.name}</b>
            </header>
            <div className="player-meter">
              <div className="meter" role="img" aria-label={`${pct(s.mass)} of comfort picks left, ${WORD[s.status]}`}>
                <span style={{ width: `${Math.max(s.mass, 0.02) * 100}%` }} />
              </div>
              <span className="big">{pct(s.mass)}</span>
            </div>
            <div className="status">
              <StatusIcon status={s.status} /> {WORD[s.status]}
            </div>
            <div className="pool-icons">
              {s.player.pool.slice(0, 6).map((e) => (
                <ChampIcon key={e.champion} name={e.champion} size={32} state={stateOf(e.champion)} caption={pct(e.share)} />
              ))}
            </div>
            <div className="muted">based on {s.player.history} games</div>
          </article>
        ))}
      </div>
    </section>
  );
}
