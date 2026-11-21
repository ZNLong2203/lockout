import { Info } from "lucide-react";
import type { WinModel } from "../api/types";
import { pct } from "../lib/draft";

interface Props {
  model: WinModel;
  timeline: number[]; // our win chance after each drafted step
  ours: string;
  opponent: string;
}

/** Live win chance from the draft state, with how it moved through this draft. */
export function WinBar({ model, timeline, ours, opponent }: Props) {
  const now = timeline[timeline.length - 1] ?? 0.5;
  const start = timeline[0] ?? now;
  const moved = (now - start) * 100;
  const ev = model.evaluation;
  const W = 120;
  const H = 26;
  const lo = Math.min(...timeline, 0.4);
  const hi = Math.max(...timeline, 0.6);
  const xy = timeline.map((p, i) => [timeline.length > 1 ? (i / (timeline.length - 1)) * W : W, H - ((p - lo) / (hi - lo || 1)) * H] as const);
  const mid = H - ((0.5 - lo) / (hi - lo || 1)) * H;
  const tip =
    `Logistic model on team Elo and the draft (pool comfort, champion win rates, Fearless pool left), fitted on ${model.n_train} earlier games. ` +
    `On ${ev.n_test} later games: ${pct(ev.accuracy)} accurate, AUC ${ev.auc.toFixed(2)}; Elo alone ${pct(ev.elo_accuracy)}, AUC ${ev.elo_auc.toFixed(2)}. ` +
    `Team strength sets the start; the draft moves it by a few points.`;
  return (
    <div className="winbar" aria-label={`Win chance: ${ours} ${pct(now)}, ${opponent} ${pct(1 - now)}`}>
      <div className="wb-head">
        <span className="wb-k">Win chance · model</span>
        <span className={`wb-moved ${moved >= 0 ? "up" : "down"}`} title="Change since the start of this draft">
          {moved >= 0 ? "+" : ""}
          {moved.toFixed(1)} pts this draft
        </span>
        <span className="wb-info" title={tip}>
          <Info size={13} aria-label="How this is computed" />
        </span>
      </div>
      <div className="wb-row">
        <b className="wb-us">{pct(now)}</b>
        <div className="wb-bar" aria-hidden>
          <span className="us" style={{ width: `${now * 100}%` }} />
          <span className="them" style={{ width: `${(1 - now) * 100}%` }} />
        </div>
        <b className="wb-them">{pct(1 - now)}</b>
        <svg className="wb-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
          <line x1={0} x2={W} y1={mid} y2={mid} className="mid" />
          <polyline points={xy.map(([x, y]) => `${x},${y}`).join(" ")} />
          {xy.length > 0 && <circle cx={xy[xy.length - 1]?.[0]} cy={xy[xy.length - 1]?.[1]} r={2.5} />}
        </svg>
      </div>
    </div>
  );
}
