import { ArrowLeftRight, Flame, Lock } from "lucide-react";
import type { Budget, BudgetRow } from "../lib/budget";
import { draftList, pct, sideOf, type GameDraft, type SeriesContext } from "../lib/draft";
import { ChampIcon, ROLE_SHORT } from "./ChampIcon";
import { TeamBadge } from "./TeamSearch";

interface Props {
  ctx: SeriesContext;
  games: GameDraft[];
  index: number;
  readOnly?: boolean;
  onSelect: (i: number) => void;
  onFinish?: (winner: "us" | "them") => void;
  onSwapSide?: () => void;
}

const tone = (m: number) => (m < 0.35 ? "critical" : m < 0.6 ? "thin" : "ok");

/** The whole series at a glance: a card per game, and how much comfort each player has left game by game. */
export function SeriesPanel({ ctx, games, index, readOnly, onSelect, onFinish, onSwapSide }: Props) {
  const current = games[index] as GameDraft;
  const complete = current.steps.every((s) => s !== null);
  const slots = Array.from({ length: Math.max(ctx.format, games.length) }, (_, i) => i);
  const lockedCount = (i: number) =>
    games.slice(0, i).reduce((n, g) => n + draftList(g, "blue", "pick").filter(Boolean).length + draftList(g, "red", "pick").filter(Boolean).length, 0);

  return (
    <section className="card series2" aria-label="The series">
      <div className="timeline" role="list">
        {slots.map((i) => {
          const g = games[i];
          if (!g) {
            return (
              <div key={i} className="g-card ghost" role="listitem">
                <div className="g-head">
                  <b>Game {i + 1}</b>
                  <span className="muted">if needed</span>
                </div>
                <div className="g-lock">
                  <Lock size={13} aria-hidden /> {i * 10} champions locked by then
                </div>
              </div>
            );
          }
          const us = draftList(g, sideOf(g, "us"), "pick");
          const them = draftList(g, sideOf(g, "them"), "pick");
          const filled = g.steps.filter((s) => s !== null).length;
          return (
            <button
              key={i}
              type="button"
              role="listitem"
              className={`g-card ${i === index ? "active" : ""} ${g.winner ?? "live"}`}
              onClick={() => onSelect(i)}
              aria-pressed={i === index}
            >
              <div className="g-head">
                <b>Game {g.number}</b>
                <span className={`g-result ${g.winner ?? "live"}`}>{g.winner === "us" ? "Win" : g.winner === "them" ? "Loss" : `Drafting ${filled}/20`}</span>
              </div>
              {g.winner === null && (
                <div className="g-progress" aria-hidden>
                  <span style={{ width: `${(filled / 20) * 100}%` }} />
                </div>
              )}
              <div className="g-team">
                <span className={`side-dot ${sideOf(g, "us")}`} aria-hidden />
                {us.map((c, k) => (
                  <ChampIcon key={k} name={c} size={22} />
                ))}
              </div>
              <div className="g-team">
                <span className={`side-dot ${sideOf(g, "them")}`} aria-hidden />
                {them.map((c, k) => (
                  <ChampIcon key={k} name={c} size={22} />
                ))}
              </div>
              <div className="g-lock">
                <Lock size={12} aria-hidden /> {lockedCount(i)} locked before
              </div>
            </button>
          );
        })}
      </div>

      {!readOnly && (
        <div className="series-actions">
          <button type="button" className="ghost" onClick={onSwapSide} disabled={current.steps.some((s) => s !== null)}>
            <ArrowLeftRight size={14} aria-hidden /> Swap sides for game {current.number}
          </button>
          {complete && current.winner === null && games.length < ctx.format && (
            <>
              <span className="muted">Game {current.number} drafted. Result:</span>
              <button type="button" onClick={() => onFinish?.("us")}>
                We won
              </button>
              <button type="button" className="secondary" onClick={() => onFinish?.("them")}>
                They won
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Comfort left per player and game: exact for played games, Monte Carlo forecast after, with a hover what-if. */
export function BudgetCard({ ctx, budget, games, current }: { ctx: SeriesContext; budget: Budget; games: number[]; current: number }) {
  return (
    <section className="card budget" aria-label="Fearless budget">
      <div className="budget-head">
        <div>
          <h3>
            <Flame size={16} aria-hidden /> Fearless budget
          </h3>
          <p className="sub">
            Share of each player's comfort pool still open at the start of every game. Played games are exact; later games are a Monte Carlo
            forecast ({budget.nSims} simulated series, same model as the backtest).
          </p>
        </div>
        {budget.whatIf ? (
          <span className="whatif-chip">
            What if <ChampIcon name={budget.whatIf} size={20} /> <b>{budget.whatIf}</b> is picked now
          </span>
        ) : (
          <span className="muted small">Hover a champion to see what picking it now costs (changes under 3 points are simulation noise and hidden).</span>
        )}
      </div>
      {budget.alerts.length > 0 && (
        <ul className="alerts">
          {budget.alerts.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <div className="budget-grid" style={{ gridTemplateColumns: `minmax(150px, 1.4fr) repeat(${games.length}, minmax(52px, 1fr))` }} role="table">
        <div className="bh" role="columnheader" />
        {games.map((g) => (
          <div key={g} className={`bh ${g === current ? "now" : ""}`} role="columnheader">
            G{g}
          </div>
        ))}
        {(["opponent", "ours"] as const).map((team) => (
          <TeamRows key={team} who={team === "ours" ? ctx.ours : ctx.opponent} team={team} rows={budget.rows.filter((r) => r.team === team)} games={games} />
        ))}
      </div>
    </section>
  );
}

function TeamRows({ who, team, rows, games }: { who: { team_id: string; name: string }; team: "ours" | "opponent"; rows: BudgetRow[]; games: number[] }) {
  return (
    <>
      <div className={`bteam ${team}`} role="rowheader" style={{ gridColumn: `1 / span ${games.length + 1}` }}>
        <TeamBadge team={who} size={18} /> {who.name}
        <span className="muted">{team === "ours" ? "us" : "opponent"}</span>
      </div>
      {rows.map((r) => (
        <div key={r.player_id} className="brow" role="row">
          <div className="bname" role="rowheader">
            <span className="role-chip">{ROLE_SHORT[r.role]}</span> {r.name}
          </div>
          {games.map((g) => {
            const c = r.cells.find((x) => x.game === g);
            if (!c) return <div key={g} className="bcell none" />;
            const label = `${r.name}, game ${g}: ${pct(c.mass)} of comfort pool open${c.risk !== null ? `, ${pct(c.risk)} chance it is critical` : ""}${c.delta ? `, what-if ${c.delta > 0 ? "+" : ""}${Math.round(c.delta * 100)} points` : ""}`;
            return (
              <div key={g} className={`bcell ${c.kind} s-${tone(c.mass)}`} role="cell" title={label} aria-label={label} style={{ ["--m" as string]: c.mass }}>
                <span className="bval">{Math.round(c.mass * 100)}</span>
                {c.delta !== null && Math.abs(c.delta) >= 0.03 && <span className={`bdelta ${c.delta < 0 ? "down" : "up"}`}>{c.delta > 0 ? "+" : ""}{Math.round(c.delta * 100)}</span>}
                {c.kind === "future" && c.risk !== null && c.risk >= 0.2 && <span className="brisk">{pct(c.risk)} risk</span>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
