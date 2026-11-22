import { motion, AnimatePresence } from "framer-motion";
import { isLive } from "../api/client";
import { Check, Crosshair, Sparkles, X } from "lucide-react";
import type { CallRate, StepAdvice, Suggestion } from "../lib/copilot";
import { ROLE_SHORT } from "./ChampIcon";
import { ChampIcon } from "./ChampIcon";

const TAG_LABEL: Record<Suggestion["tags"][number], string> = {
  comfort: "comfort",
  deny: "deny",
  "ban-risk": "ban risk",
  comp: "comp",
  habit: "habit",
  fragile: "fragile pool",
};

interface Props {
  advice: StepAdvice | null;
  calls: CallRate;
  /** Clicking a card enters that champion (live drafting only). */
  onApply?: (champion: string) => void;
  onHover?: (champion: string | null) => void;
  /** Change in our win chance (0..1 points) if this champion were picked now, by champion. */
  deltas?: Map<string, number>;
  /** In a replay: the step just revealed, and whether the co-pilot had it in its top three. */
  last?: { champion: string; hit: boolean; label: string } | null;
}

/** The co-pilot strip: three best moves for us, or the three likeliest moves of the opponent, each with why and n. */
export function Copilot({ advice, calls, onApply, onHover, last, deltas }: Props) {
  if (!advice) {
    return (
      <div className="copilot done">
        <Sparkles size={16} aria-hidden /> Draft complete.
        {last && <Last last={last} />}
        <CallChip calls={calls} />
      </div>
    );
  }
  const verb = advice.action === "ban" ? "ban" : "pick";
  return (
    <div className={`copilot ${advice.ours ? "ours" : "theirs"}`} aria-live="polite">
      <div className="copilot-head">
        <span className="copilot-k">
          {advice.ours ? <Sparkles size={14} aria-hidden /> : <Crosshair size={14} aria-hidden />}
          {advice.ours ? `Co-pilot · our ${verb}` : `Prediction · their ${verb}`}
        </span>
        <CallChip calls={calls} />
      </div>
      <div className="copilot-cards">
        <AnimatePresence mode="popLayout" initial={false}>
          {advice.suggestions.slice(0, 3).map((s, i) => {
            return (
              <motion.button
                layout
                key={`${advice.step}-${s.champion}`}
                type="button"
                className="sugg"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.18, delay: i * 0.04 }}
                onClick={onApply ? () => onApply(s.champion) : undefined}
                onMouseEnter={() => onHover?.(s.champion)}
                onMouseLeave={() => onHover?.(null)}
                disabled={!onApply}
                title={onApply ? `Enter ${s.champion}` : undefined}
              >
                <span className="sugg-rank">{i + 1}</span>
                <ChampIcon name={s.champion} size={44} />
                <span className="sugg-body">
                  <b>
                    {s.title}
                    {s.role && <span className="role-chip">{ROLE_SHORT[s.role]}</span>}
                  </b>
                  <span className="sugg-reason">{s.reason}</span>
                  <span className="sugg-foot">
                    {deltas?.has(s.champion) && <WinDelta d={deltas.get(s.champion) as number} />}
                    <span className="n">{s.evidence}</span>
                    {s.tags.slice(0, 2).map((t) => (
                      <span key={t} className={`tag t-${t}`}>
                        {TAG_LABEL[t]}
                      </span>
                    ))}
                  </span>
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {advice.suggestions.length === 0 && <p className="muted">No pool or league data for this step.</p>}
      </div>
      {advice.suggestions.length > 3 && (
        <div className="shortlist-row" aria-label="Shortlist, ranks 4 to 10">
          <span className="sl-k" title="Ranks 4-10. On the 80 most recent real series, the real choice was in the top 10 about 3 times in 4.">
            Also in the top 10
          </span>
          {advice.suggestions.slice(3).map((s, i) => (
            <button
              key={s.champion}
              type="button"
              className="sl-chip"
              title={`#${i + 4} ${s.title}: ${s.reason}`}
              onClick={onApply ? () => onApply(s.champion) : undefined}
              onMouseEnter={() => onHover?.(s.champion)}
              onMouseLeave={() => onHover?.(null)}
              disabled={!onApply}
            >
              <ChampIcon name={s.champion} size={24} />
              <span>{s.champion}</span>
            </button>
          ))}
        </div>
      )}
      {last && <Last last={last} />}
    </div>
  );
}

function CallChip({ calls }: { calls: CallRate }) {
  // the demo's series and pools are invented, so a call rate on them would say nothing about real drafts
  if (!calls.total || !isLive) return null;
  return (
    <span
      className="call-chip"
      title={`Steps already drafted where the real choice was in the co-pilot's top 3 (and top 10), judged only on what was known before each step. Top 3: ours ${calls.ours.hits}/${calls.ours.total}, theirs ${calls.theirs.hits}/${calls.theirs.total}.`}
    >
      Called <b>{calls.hits}</b>/{calls.total} · top 10 <b>{calls.hits10}</b>
    </span>
  );
}

function Last({ last }: { last: { champion: string; hit: boolean; label: string } }) {
  return (
    <div className={`reveal ${last.hit ? "hit" : "miss"}`}>
      {last.hit ? <Check size={14} aria-hidden /> : <X size={14} aria-hidden />}
      {last.label}: <ChampIcon name={last.champion} size={22} /> <b>{last.champion}</b>
      <span className="muted">{last.hit ? "in the top three" : "not in the top three"}</span>
    </div>
  );
}

function WinDelta({ d }: { d: number }) {
  const pts = d * 100;
  if (Math.abs(pts) < 0.05) return null;
  return (
    <span className={`win-delta ${pts > 0 ? "up" : "down"}`} title="Change in our win chance, in percentage points, if this is picked now (model)">
      {pts > 0 ? "+" : ""}
      {pts.toFixed(1)} pts
    </span>
  );
}
