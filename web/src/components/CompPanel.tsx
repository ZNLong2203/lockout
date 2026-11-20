import { AlertTriangle, Shield, Swords, Target } from "lucide-react";
import { composition } from "../lib/comp";
import { infoOf, useCatalog } from "../lib/ddragon";

/** Composition check for one side's picks: damage split, frontline, engage, range and power curve. */
export function CompPanel({ champions }: { champions: string[] }) {
  const catalog = useCatalog();
  if (champions.length === 0) return <div className="comp empty muted">Composition appears as picks come in.</div>;
  const c = composition(champions, (n) => infoOf(catalog, n));
  const ad = Math.round(c.physical * 100);
  const curve = c.curve <= -0.25 ? "Early" : c.curve >= 0.25 ? "Late" : "Even";
  return (
    <div className="comp" aria-label="Composition check">
      <div className="comp-dmg" title={`Damage profile from Riot's attack/magic ratings: ${ad}% physical, ${100 - ad}% magic`}>
        <span className="lbl">AD</span>
        <div className="dmg-bar" aria-hidden>
          <span className="ad" style={{ width: `${ad}%` }} />
          <span className="ap" style={{ width: `${100 - ad}%` }} />
        </div>
        <span className="lbl">AP</span>
      </div>
      <div className="comp-stats">
        <span title="Tanks, and fighters with a defense rating of 6+ (Riot classification)">
          <Shield size={13} aria-hidden /> {c.frontline} front
        </span>
        <span title="Reliable hard engage (editorial list)">
          <Swords size={13} aria-hidden /> {c.engage} engage
        </span>
        <span title="Basic attack range above 300 units (Riot stats)">
          <Target size={13} aria-hidden /> {c.ranged} ranged
        </span>
        <span className={`curve c-${curve.toLowerCase()}`} title="Power curve from an editorial early/late list">
          {curve}
        </span>
      </div>
      {c.warnings.slice(0, 2).map((w) => (
        <div key={w} className="comp-warn">
          <AlertTriangle size={12} aria-hidden /> {w}
        </div>
      ))}
    </div>
  );
}
