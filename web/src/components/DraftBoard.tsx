import { useMemo, useState } from "react";
import { splashUrl, useCatalog } from "../lib/ddragon";
import { ORDER, draftList, lockedBefore, nextStep, sideOf, usedIn, type GameDraft, type SeriesContext, type Side } from "../lib/draft";
import { ChampIcon, ROLE_SHORT, type ChampState } from "./ChampIcon";

interface Props {
  ctx: SeriesContext;
  games: GameDraft[];
  index: number;
  onPick: (champion: string) => void;
  onUndo: () => void;
  onClear: () => void;
}

function TeamColumn({ ctx, game, side }: { ctx: SeriesContext; game: GameDraft; side: Side }) {
  const catalog = useCatalog();
  const who = sideOf(game, "us") === side ? "us" : "them";
  const team = who === "us" ? ctx.ours : ctx.opponent;
  const roleOf = (c: string) => team.players.find((p) => p.pool.some((e) => e.champion === c))?.role;
  const picks = draftList(game, side, "pick");
  const bans = draftList(game, side, "ban");
  return (
    <div className={`team-col ${side}`}>
      <div className="team-col-head">
        <span className={`side-dot ${side}`} aria-hidden />
        <div>
          <b>{team.name}</b>
          <div className="muted">{side === "blue" ? "Blue side" : "Red side"} · {who === "us" ? "us" : "opponent"}</div>
        </div>
      </div>
      <div className="ban-row" aria-label={`${team.name} bans`}>
        {bans.map((b, i) => (
          <ChampIcon key={i} name={b} size={30} state={b ? "banned" : undefined} />
        ))}
      </div>
      <ol className="pick-list" aria-label={`${team.name} picks`}>
        {picks.map((p, i) => (
          <li key={i} className={`pick-banner ${p ? "filled" : ""}`} style={p && splashUrl(catalog, p) ? { backgroundImage: `url(${splashUrl(catalog, p)})` } : undefined}>
            <span className="pick-shade" aria-hidden />
            <span className="pick-name">{p ?? `Pick ${i + 1}`}</span>
            {p && roleOf(p) && <span className="role-tag">{ROLE_SHORT[roleOf(p) as string]}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

type Filter = "theirs" | "ours" | "all";

export function DraftBoard({ ctx, games, index, onPick, onUndo, onClear }: Props) {
  const catalog = useCatalog();
  const game = games[index] as GameDraft;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("theirs");
  const locked = useMemo(() => lockedBefore(games, index), [games, index]);
  const used = usedIn(game);
  const bans = new Set(ORDER.map((o, i) => (o.action === "ban" ? game.steps[i] : null)).filter(Boolean) as string[]);
  const ourPool = useMemo(() => new Set(ctx.ours.players.flatMap((p) => p.pool.map((e) => e.champion))), [ctx]);
  const theirPool = useMemo(() => new Set(ctx.opponent.players.flatMap((p) => p.pool.map((e) => e.champion))), [ctx]);
  const universe = catalog.names.length ? catalog.names : [...new Set([...ourPool, ...theirPool])].sort();
  const shown = universe.filter(
    (c) =>
      c.toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || (filter === "ours" ? ourPool.has(c) : theirPool.has(c))),
  );
  const step = nextStep(game);
  const current = step >= 0 ? ORDER[step] : null;
  const whoNow = current ? (sideOf(game, "us") === current.side ? ctx.ours.name : ctx.opponent.name) : null;
  const stateOf = (c: string): ChampState => (locked.has(c) ? "locked" : bans.has(c) ? "banned" : used.has(c) ? "used" : undefined);
  const markOf = (c: string) => (ourPool.has(c) && theirPool.has(c) ? "both" : ourPool.has(c) ? "ours" : theirPool.has(c) ? "theirs" : undefined);

  return (
    <section className="card board-card" aria-label={`Draft board, game ${game.number}`}>
      <div className="board">
        <TeamColumn ctx={ctx} game={game} side="blue" />
        <div className="picker">
          <div className={`turn ${current?.side ?? ""}`} aria-live="polite">
            {current ? (
              <>
                <span className="turn-k">Now</span> {whoNow} · {current.action === "ban" ? "ban" : "pick"} ({step + 1}/20)
              </>
            ) : (
              <>Draft complete</>
            )}
          </div>
          <div className="picker-tools">
            <input type="search" placeholder="Search champion…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search champion" />
            <div className="chips" role="radiogroup" aria-label="Show champions">
              {(["theirs", "ours", "all"] as Filter[]).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                  {f === "theirs" ? "Their pools" : f === "ours" ? "Our pools" : "All"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid-champs">
            {shown.map((c) => (
              <ChampIcon key={c} name={c} size={46} state={stateOf(c)} mark={markOf(c)} onClick={current ? () => onPick(c) : undefined} caption={c} />
            ))}
            {shown.length === 0 && <p className="muted">No champion matches.</p>}
          </div>
          <div className="picker-foot">
            <span className="legend-inline">
              <span className="champ-mark theirs static" /> in their pools <span className="champ-mark ours static" /> in our pools · locked = picked in an earlier game
            </span>
            <span>
              <button type="button" className="ghost" onClick={onUndo} disabled={step === 0}>
                Undo
              </button>{" "}
              <button type="button" className="ghost" onClick={onClear}>
                Clear game
              </button>
            </span>
          </div>
        </div>
        <TeamColumn ctx={ctx} game={game} side="red" />
      </div>
    </section>
  );
}
