import type { PoolStatus, RolePool, TeamPoolState } from "../api/types";

const LABEL: Record<PoolStatus, string> = { ok: "Comfortable", thin: "Thin", critical: "Critical" };

// A status never relies on colour alone: every state carries an icon and a word.
function StatusIcon({ status }: { status: PoolStatus }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": true } as const;
  if (status === "ok")
    return (
      <svg {...common}>
        <path d="M2 7.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === "thin")
    return (
      <svg {...common}>
        <path d="M7 1.5l6 10.5H1z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M3 3l8 8M11 3l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function RoleRow({ r }: { r: RolePool }) {
  const best = r.remaining.slice(0, 3).map((e) => `${e.champion} ${Math.round(e.share * 100)}%`).join(", ");
  return (
    <div className={`role s-${r.status}`}>
      <span className="name">{r.role}</span>
      <div className="meter" role="img" aria-label={`${r.role}: ${Math.round(r.mass * 100)}% of the pool left, ${LABEL[r.status]}`}>
        <span style={{ width: `${Math.max(r.mass, 0.01) * 100}%` }} />
      </div>
      <span className="pct">{Math.round(r.mass * 100)}%</span>
      {r.player_name && <span className="player">{r.player_name}</span>}
      <span className="detail">
        <span className="status">
          <StatusIcon status={r.status} /> {LABEL[r.status]}
        </span>
        {" · "}
        {best || "nothing left"} · depth {r.depth} · based on {r.history} picks
      </span>
    </div>
  );
}

export function PoolRunwayCard({ team, accent, title }: { team: TeamPoolState; accent: string; title: string }) {
  return (
    <section className="card" aria-label={`${title} pool state`}>
      <h2>
        <span style={{ color: accent }} aria-hidden>
          ●{" "}
        </span>
        {team.name} <span className="muted">({title})</span>
      </h2>
      <p className="sub">Share of each player's comfortable pool still available. Weakest role first.</p>
      <div>
        {team.roles.map((r) => (
          <RoleRow key={r.player_id} r={r} />
        ))}
      </div>
      {team.untrusted_roles.length > 0 && (
        <p className="muted">Not enough history to judge: {team.untrusted_roles.join(", ")}.</p>
      )}
    </section>
  );
}
