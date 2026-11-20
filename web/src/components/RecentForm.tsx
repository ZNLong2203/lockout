import { clock, type PastGame } from "../lib/draft";
import { ChampIcon } from "./ChampIcon";

function repeats(games: PastGame[], pick: (g: PastGame) => string[]) {
  const counts = new Map<string, number>();
  games.forEach((g) => pick(g).forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1)));
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
}

/** The opponent's last games: what repeats in their drafts, then each draft in full. */
export function RecentForm({ team, games }: { team: string; games: PastGame[] }) {
  const bans = repeats(games, (g) => g.bans);
  const picks = repeats(games, (g) => g.picks.map((p) => p.champion));
  return (
    <section className="card" aria-label={`${team} recent games`}>
      <h2>{team}: what repeats in their drafts</h2>
      <p className="sub">Their last {games.length} games. Anything that shows up twice or more is listed first.</p>
      <div className="repeats">
        <div>
          <div className="repeat-k">Bans they keep making</div>
          <div className="repeat-row">
            {bans.map(([c, n]) => (
              <span key={c} className="repeat">
                <ChampIcon name={c} size={36} />
                <b>
                  {n}/{games.length}
                </b>
              </span>
            ))}
            {bans.length === 0 && <span className="muted">No repeated ban.</span>}
          </div>
        </div>
        <div>
          <div className="repeat-k">Picks they come back to</div>
          <div className="repeat-row">
            {picks.map(([c, n]) => (
              <span key={c} className="repeat">
                <ChampIcon name={c} size={36} />
                <b>
                  {n}/{games.length}
                </b>
              </span>
            ))}
            {picks.length === 0 && <span className="muted">No repeated pick.</span>}
          </div>
        </div>
      </div>
      <div className="recent">
        <div className="recent-row recent-head" aria-hidden>
          <span>Game</span>
          <span>Picks</span>
          <span>Bans</span>
        </div>
        {games.map((g) => (
          <div className="recent-row" key={g.game_id}>
            <div className="recent-meta">
              <span className={`result ${g.won ? "us" : "them"}`}>{g.won ? "W" : "L"}</span>
              <div>
                <b>vs {g.opponent}</b>
                <div className="muted">
                  {g.date} · {g.side} side · {clock(g.duration_s)}
                </div>
              </div>
            </div>
            <div className="recent-picks" aria-label="Picks">
              {g.picks.map((p) => (
                <ChampIcon key={p.champion} name={p.champion} size={34} />
              ))}
            </div>
            <div className="recent-bans" aria-label="Bans">
              {g.bans.map((b) => (
                <ChampIcon key={b} name={b} size={28} state="banned" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
