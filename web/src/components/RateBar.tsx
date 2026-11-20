import type { Rate } from "../api/types";
import { pct } from "../lib/draft";

/** A rate with its 95% interval and the league baseline, always next to its sample size. */
export function RateBar({ rate, label }: { rate: Rate; label: string }) {
  const text = `${rate.hits} of ${rate.n} (${pct(rate.rate)}), 95% interval ${pct(rate.ci_lo)} to ${pct(rate.ci_hi)}${
    rate.baseline !== null ? `, league ${pct(rate.baseline)}` : ""
  }`;
  return (
    <div className="ratebar" role="img" aria-label={`${label}: ${text}`}>
      <div className="ratebar-track" aria-hidden>
        <span className="ratebar-ci" style={{ left: `${rate.ci_lo * 100}%`, width: `${Math.max((rate.ci_hi - rate.ci_lo) * 100, 1)}%` }} />
        {rate.baseline !== null && <span className="ratebar-base" style={{ left: `${rate.baseline * 100}%` }} />}
        <span className="ratebar-dot" style={{ left: `${rate.rate * 100}%` }} />
      </div>
      <div className="ratebar-text" aria-hidden>
        <b>{pct(rate.rate)}</b> <span className="muted">{rate.hits}/{rate.n}</span>
        {rate.baseline !== null && <span className="muted"> · league {pct(rate.baseline)}</span>}
      </div>
    </div>
  );
}
