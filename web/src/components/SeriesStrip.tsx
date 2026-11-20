import { draftList, sideOf, type GameDraft, type SeriesContext } from "../lib/draft";
import { ChampIcon } from "./ChampIcon";

interface Props {
  ctx: SeriesContext;
  games: GameDraft[];
  index: number;
  onSelect: (i: number) => void;
  onFinish: (winner: "us" | "them") => void;
  onSwapSide: () => void;
}

export function SeriesStrip({ ctx, games, index, onSelect, onFinish, onSwapSide }: Props) {
  const usWins = games.filter((g) => g.winner === "us").length;
  const themWins = games.filter((g) => g.winner === "them").length;
  const current = games[index] as GameDraft;
  const complete = current.steps.every((s) => s !== null);
  return (
    <section className="card series" aria-label="Series so far">
      <div className="series-head">
        <div>
          <h2>Series so far</h2>
          <p className="sub">Every champion picked in an earlier game is locked for both teams (Fearless).</p>
        </div>
        <div className="score" aria-label={`Score ${usWins} to ${themWins}`}>
          <span>{ctx.ours.short}</span>
          <b>{usWins}</b>
          <span className="muted">–</span>
          <b>{themWins}</b>
          <span>{ctx.opponent.short}</span>
          <span className="muted">· Bo{ctx.format}</span>
        </div>
      </div>
      <div className="series-games">
        {games.map((g, i) => {
          const us = draftList(g, sideOf(g, "us"), "pick").filter(Boolean) as string[];
          const them = draftList(g, sideOf(g, "them"), "pick").filter(Boolean) as string[];
          return (
            <button key={g.number} type="button" className={`game-tile ${i === index ? "active" : ""}`} onClick={() => onSelect(i)} aria-pressed={i === index}>
              <div className="game-tile-head">
                <b>Game {g.number}</b>
                <span className={`result ${g.winner ?? "live"}`}>{g.winner === "us" ? "Win" : g.winner === "them" ? "Loss" : "Drafting"}</span>
              </div>
              <div className="mini-team">
                <span className={`side-dot ${sideOf(g, "us")}`} aria-hidden />
                {us.length ? us.map((c) => <ChampIcon key={c} name={c} size={24} />) : <span className="muted">—</span>}
              </div>
              <div className="mini-team">
                <span className={`side-dot ${sideOf(g, "them")}`} aria-hidden />
                {them.length ? them.map((c) => <ChampIcon key={c} name={c} size={24} />) : <span className="muted">—</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="series-actions">
        <button type="button" className="ghost" onClick={onSwapSide} disabled={current.steps.some((s) => s !== null)}>
          Swap sides for game {current.number}
        </button>
        {complete && current.winner === null && games.length < ctx.format && (
          <>
            <span className="muted">Game {current.number} drafted. Result:</span>
            <button type="button" onClick={() => onFinish("us")}>
              We won
            </button>
            <button type="button" className="secondary" onClick={() => onFinish("them")}>
              They won
            </button>
          </>
        )}
      </div>
    </section>
  );
}
