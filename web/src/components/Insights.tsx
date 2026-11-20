import { Ban, ShieldAlert, TrendingDown } from "lucide-react";
import type { Meta } from "../lib/copilot";
import { banIdeas, pct, type RoleState, type SeriesContext } from "../lib/draft";
import { ChampIcon, ROLE_SHORT } from "./ChampIcon";

interface Props {
  ctx: SeriesContext;
  them: RoleState[];
  us: RoleState[];
  gameNumber: number;
  meta?: Meta;
  /** Set when it is our ban: the shortlist gets a one-click Ban button. */
  onBan?: (champion: string) => void;
}

/** The coach's brief for the game being drafted: where to hit, what to protect, how much comfort to expect. */
export function Insights({ ctx, them, us, gameNumber, meta, onBan }: Props) {
  const weakest = them[0];
  const ban = banIdeas(them, 1)[0];
  const ourWeak = us[0];
  const save = ourWeak?.available[0];
  const league = ctx.league_top3_share_by_game;
  const recent = ctx.opponent_recent;
  const shortlist = banIdeas(them, 6);

  return (
    <section className="card brief" aria-label="Game brief">
      <div className="brief-head">
        <h2>Game {gameNumber} brief</h2>
        <span className="muted small">Pools are each player's own picks, weighted by recency (half-life 120 days)</span>
      </div>
      <div className="brief-tiles">
        {ban && weakest && (
          <article className="tile t-hit">
            <span className="tile-k">
              <Ban size={13} aria-hidden /> Hit first
            </span>
            <div className="tile-main">
              <ChampIcon name={ban.champion} size={52} />
              <div>
                <b className="big">{pct(ban.bite)}</b>
                <span>
                  of {ban.player}'s ({ROLE_SHORT[ban.role]}) remaining comfort is <b>{ban.champion}</b>
                </span>
              </div>
            </div>
            <Meter value={weakest.mass} label={`${weakest.player.name} has ${pct(weakest.mass)} of the pool left`} />
          </article>
        )}
        {ourWeak && save && (
          <article className="tile t-protect">
            <span className="tile-k">
              <ShieldAlert size={13} aria-hidden /> Protect
            </span>
            <div className="tile-main">
              <ChampIcon name={save.champion} size={52} />
              <div>
                <b className="big">{pct(ourWeak.mass)}</b>
                <span>
                  left for our {ROLE_SHORT[ourWeak.player.role]} {ourWeak.player.name}; {save.champion} is {pct(ourWeak.mass ? save.share / ourWeak.mass : 0)} of it.
                  Pick it early or expect it banned.
                </span>
              </div>
            </div>
            <Meter value={ourWeak.mass} label={`${ourWeak.player.name} has ${pct(ourWeak.mass)} of the pool left`} />
          </article>
        )}
        {league.length > 0 && (
          <article className="tile t-league">
            <span className="tile-k">
              <TrendingDown size={13} aria-hidden /> Comfort by game (league)
            </span>
            <div className="spark-bars" role="img" aria-label={`Share of picks from a player's top 3: ${league.map((v, i) => `game ${i + 1} ${pct(v)}`).join(", ")}`}>
              {league.map((v, i) => (
                <span key={i} className={i + 1 === gameNumber ? "now" : ""}>
                  <i style={{ height: `${Math.max(v / Math.max(...league), 0.05) * 100}%` }} />
                  <em>{pct(v)}</em>
                  <small>G{i + 1}</small>
                </span>
              ))}
            </div>
            <span className="small muted">Picks from a player's top 3 champions, all Fearless series in the data.</span>
          </article>
        )}
      </div>

      <div className="shortlist2-head">
        <h3 className="h3">Ban shortlist</h3>
        <span className="muted small">bite on a fragile pool · their last {recent.length} games · league ban rate</span>
      </div>
      <ol className="shortlist2">
        {shortlist.map((b) => {
          const seen = recent.map((g) => (g.picks.some((p) => p.champion === b.champion) ? "pick" : g.bans.includes(b.champion) ? "ban" : ""));
          const m = meta?.get(b.champion);
          return (
            <li key={b.champion}>
              <ChampIcon name={b.champion} size={36} />
              <div className="sl-name">
                <b>{b.champion}</b>
                <span className="muted">
                  {ROLE_SHORT[b.role]} · {b.player}
                </span>
              </div>
              <div className="sl-bite" title={`${pct(b.bite)} of what ${b.player} has left`}>
                <div className="meter s-critical" aria-hidden>
                  <span style={{ width: `${b.bite * 100}%` }} />
                </div>
                <span>{pct(b.bite)}</span>
              </div>
              <div className="sl-recent" title="Their last games, newest first: filled = picked, ring = banned">
                {seen.map((k, i) => (
                  <span key={i} className={`dot ${k}`} />
                ))}
              </div>
              <span className="sl-meta" title={m ? `banned in ${m.bans} of ${m.games} league games` : "no league data"}>
                {m ? pct(m.bans / Math.max(m.games, 1)) : "—"}
              </span>
              {onBan && (
                <button type="button" className="ghost sl-ban" onClick={() => onBan(b.champion)}>
                  Ban
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Meter({ value, label }: { value: number; label: string }) {
  const s = value < 0.35 ? "critical" : value < 0.6 ? "thin" : "ok";
  return (
    <div className="tile-meter" title={label}>
      <div className={`meter s-${s}`} aria-hidden>
        <span style={{ width: `${Math.min(value, 1) * 100}%` }} />
      </div>
      <span className="small muted">{label}</span>
    </div>
  );
}
