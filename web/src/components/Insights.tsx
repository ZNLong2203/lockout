import type { ReactNode } from "react";
import { banIdeas, clock, pct, type RoleState, type SeriesContext } from "../lib/draft";
import { ChampIcon } from "./ChampIcon";

interface Props {
  ctx: SeriesContext;
  them: RoleState[];
  us: RoleState[];
  gameNumber: number;
  jungler: string | null;
}

function Row({ icon, tone, children }: { icon: ReactNode; tone: "act" | "warn" | "info"; children: ReactNode }) {
  return (
    <li className={`insight ${tone}`}>
      <div className="insight-icon">{icon}</div>
      <div>{children}</div>
    </li>
  );
}

/** The coach-facing summary: four plain sentences, each with the evidence behind it. */
export function Insights({ ctx, them, us, gameNumber, jungler }: Props) {
  const weakest = them[0];
  const ban = banIdeas(them, 1)[0];
  const ourWeak = us[0];
  const save = ourWeak?.available[0];
  const bridge = jungler ? ctx.jungle_bridges[jungler] : undefined;
  const top3 = ctx.league_top3_share_by_game[Math.min(gameNumber, ctx.league_top3_share_by_game.length) - 1];
  const lane = bridge ? (Object.entries(bridge.first_lane).sort((a, b) => b[1] - a[1])[0] ?? null) : null;

  return (
    <section className="card" aria-label="What this means">
      <h2>What this means for game {gameNumber}</h2>
      <ul className="insights">
        {ban && (
          <Row tone="act" icon={<ChampIcon name={ban.champion} size={40} />}>
            <b>Ban {ban.champion}.</b> It is {pct(ban.bite)} of what their {ban.role} <b>{ban.player}</b> still has.
            {weakest && ` Their ${weakest.player.role} is down to ${pct(weakest.mass)} of comfort picks.`}
          </Row>
        )}
        {ourWeak && save && (
          <Row tone="warn" icon={<ChampIcon name={save.champion} size={40} />}>
            <b>Protect our {ourWeak.player.role}.</b> {ourWeak.player.name} has {pct(ourWeak.mass)} of comfort picks left;{" "}
            {save.champion} alone is {pct(ourWeak.mass ? save.share / ourWeak.mass : 0)} of it. Pick it early or expect it banned.
          </Row>
        )}
        {bridge && lane && (
          <Row tone="info" icon={<ChampIcon name={bridge.champion} size={40} />}>
            <b>If they lock {bridge.champion}:</b> their jungler opened {bridge.start_bot >= bridge.start_top ? "bot-side" : "top-side"} in{" "}
            {pct(Math.max(bridge.start_bot, bridge.start_top))} of games and showed up first in <b>{lane[0]}</b> ({pct(lane[1])})
            {bridge.median_first_lane_t !== null && ` around ${clock(bridge.median_first_lane_t)}`}.{" "}
            <span className="muted">
              n = {bridge.n}, {bridge.scope === "team" ? "this team" : "league-wide"}
              {bridge.n < 10 && ", small sample"}
            </span>
          </Row>
        )}
        {top3 !== undefined && (
          <Row tone="info" icon={<span className="insight-num">G{gameNumber}</span>}>
            <b>Expect less comfort.</b> Across the league, only {pct(top3)} of picks in game {gameNumber} come from a player's top 3 champions
            {gameNumber > 1 ? " (40% in game 1)." : "."}
          </Row>
        )}
      </ul>
      <h3 className="h3">Ban shortlist</h3>
      <p className="sub">Ranked by how much of a fragile player's remaining comfort pool each ban removes.</p>
      <ol className="shortlist">
        {banIdeas(them, 5).map((b) => (
          <li key={b.champion}>
            <ChampIcon name={b.champion} size={34} />
            <div>
              <b>{b.champion}</b>
              <div className="muted">
                {b.role} · {b.player}
              </div>
            </div>
            <div className="bite">
              <div className="meter s-critical" aria-hidden>
                <span style={{ width: `${b.bite * 100}%` }} />
              </div>
              <span>{pct(b.bite)}</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
