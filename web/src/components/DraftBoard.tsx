import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { CallRate, Meta, StepAdvice } from "../lib/copilot";
import { splashUrl, useCatalog } from "../lib/ddragon";
import { ORDER, assignPicks, lockedBefore, nextStep, sideOf, usedIn, type GameDraft, type SeriesContext, type Side } from "../lib/draft";
import { ChampIcon, ROLE_SHORT, type ChampState } from "./ChampIcon";
import { CompPanel } from "./CompPanel";
import { Copilot } from "./Copilot";
import { WinBar } from "./WinBar";
import type { WinModel } from "../api/types";

interface Props {
  ctx: SeriesContext;
  games: GameDraft[];
  index: number;
  advice: StepAdvice | null;
  calls: CallRate;
  meta?: Meta;
  last?: { champion: string; hit: boolean; label: string } | null;
  /** Absent in a replay: the board is read-only. */
  onPick?: (champion: string) => void;
  onUndo?: () => void;
  onClear?: () => void;
  onHover?: (champion: string | null) => void;
  win?: { model: WinModel; timeline: number[]; deltas: Map<string, number> } | null;
}

const slotsOf = (side: Side, action: "ban" | "pick") => ORDER.map((o, i) => (o.side === side && o.action === action ? i : -1)).filter((i) => i >= 0);

function TeamColumn({ ctx, game, side, calls, meta }: { ctx: SeriesContext; game: GameDraft; side: Side; calls: CallRate; meta?: Meta }) {
  const catalog = useCatalog();
  const who = sideOf(game, "us") === side ? "us" : "them";
  const team = who === "us" ? ctx.ours : ctx.opponent;
  const next = nextStep(game);
  const pickSlots = slotsOf(side, "pick");
  const banSlots = slotsOf(side, "ban");
  const picks = pickSlots.map((i) => game.steps[i] ?? null);
  const assigned = assignPicks(team, picks.filter((c): c is string => !!c), (c) => meta?.get(c)?.role);
  const playerOf = (c: string) => team.players.find((p) => assigned.get(p.player_id) === c);
  const called = (i: number) => calls.steps[i] === true;
  return (
    <div className={`team-col ${side}`}>
      <div className="team-col-head">
        <span className={`side-dot ${side}`} aria-hidden />
        <div>
          <b>{team.name}</b>
          <div className="muted">
            {side === "blue" ? "Blue side" : "Red side"} · {who === "us" ? "us" : "opponent"}
          </div>
        </div>
      </div>
      <div className="ban-row" aria-label={`${team.name} bans`}>
        {banSlots.map((i) => (
          <span key={i} className={`ban-slot ${i === next ? "next" : ""}`}>
            <ChampIcon name={game.steps[i] ?? null} size={30} state={game.steps[i] ? "banned" : undefined} />
            {called(i) && <Check className="called" size={11} aria-label="called by the co-pilot" />}
          </span>
        ))}
      </div>
      <ol className="pick-list" aria-label={`${team.name} picks`}>
        {pickSlots.map((i, k) => {
          const c = game.steps[i] ?? null;
          const bg = c ? splashUrl(catalog, c) : null;
          const player = c ? playerOf(c) : undefined;
          return (
            <li key={i} className={`pick-banner ${c ? "filled" : ""} ${i === next ? "next" : ""}`} style={bg ? { backgroundImage: `url(${bg})` } : undefined}>
              <span className="pick-shade" aria-hidden />
              <span className="pick-name">
                {c ?? (i === next ? "Picking…" : `Pick ${k + 1}`)}
                {player && <small>{player.name}</small>}
              </span>
              {player && <span className="role-tag">{ROLE_SHORT[player.role]}</span>}
              {called(i) && <Check className="called" size={13} aria-label="called by the co-pilot" />}
            </li>
          );
        })}
      </ol>
      <CompPanel champions={picks.filter((c): c is string => !!c)} />
    </div>
  );
}

type Filter = "suggested" | "theirs" | "ours" | "all";
const ROLES = ["all", "top", "jungle", "mid", "adc", "support"] as const;

export function DraftBoard({ ctx, games, index, advice, calls, meta, last, onPick, onUndo, onClear, onHover, win }: Props) {
  const catalog = useCatalog();
  const game = games[index] as GameDraft;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [role, setRole] = useState<(typeof ROLES)[number]>("all");
  const locked = useMemo(() => lockedBefore(games, index), [games, index]);
  const used = usedIn(game);
  const bans = new Set(ORDER.map((o, i) => (o.action === "ban" ? game.steps[i] : null)).filter(Boolean) as string[]);
  const ourPool = useMemo(() => new Set(ctx.ours.players.flatMap((p) => p.pool.map((e) => e.champion))), [ctx]);
  const theirPool = useMemo(() => new Set(ctx.opponent.players.flatMap((p) => p.pool.map((e) => e.champion))), [ctx]);
  const poolRole = useMemo(() => {
    const m = new Map<string, Set<string>>();
    [...ctx.ours.players, ...ctx.opponent.players].forEach((p) => p.pool.forEach((e) => m.set(e.champion, new Set([...(m.get(e.champion) ?? []), p.role]))));
    return m;
  }, [ctx]);
  const playsRole = (c: string, r: string) => {
    const m = meta?.get(c);
    if (m && Object.keys(m.roles).length) return (m.roles[r] ?? 0) >= 0.15;
    return poolRole.get(c)?.has(r) ?? false;
  };
  const rank = new Map((advice?.suggestions ?? []).slice(0, 3).map((s, i) => [s.champion, i + 1]));
  const top10 = new Set((advice?.suggestions ?? []).map((s) => s.champion));
  const universe = catalog.names.length ? catalog.names : [...new Set([...ourPool, ...theirPool, ...(meta ? [...meta.keys()] : [])])].sort();
  const shown = universe.filter(
    (c) =>
      c.toLowerCase().includes(query.toLowerCase()) &&
      (role === "all" || playsRole(c, role)) &&
      (filter === "all" || (filter === "suggested" ? top10.has(c) : filter === "ours" ? ourPool.has(c) : theirPool.has(c))),
  );
  const step = nextStep(game);
  const current = step >= 0 ? ORDER[step] : null;
  const whoNow = current ? (sideOf(game, "us") === current.side ? ctx.ours.name : ctx.opponent.name) : null;
  const stateOf = (c: string): ChampState => (locked.has(c) ? "locked" : bans.has(c) ? "banned" : used.has(c) ? "used" : undefined);
  const markOf = (c: string) => (ourPool.has(c) && theirPool.has(c) ? "both" : ourPool.has(c) ? "ours" : theirPool.has(c) ? "theirs" : undefined);

  return (
    <section className="card board-card" aria-label={`Draft board, game ${game.number}`}>
      <div className="board">
        <TeamColumn ctx={ctx} game={game} side="blue" calls={calls} meta={meta} />
        <div className="picker">
          <div className={`turn ${current?.side ?? ""}`} aria-live="polite">
            {current ? (
              <>
                <span className="turn-k">Now</span> {whoNow} · {current.action === "ban" ? "ban" : "pick"} ({step + 1}/20)
                <span className="turn-steps" aria-hidden>
                  {ORDER.map((o, i) => (
                    <span key={i} className={`ts ${o.side} ${o.action} ${i < step ? "done" : i === step ? "now" : ""}`} />
                  ))}
                </span>
              </>
            ) : (
              <>Draft complete</>
            )}
          </div>
          {win && <WinBar model={win.model} timeline={win.timeline} ours={ctx.ours.name} opponent={ctx.opponent.name} />}
          <Copilot advice={advice} calls={calls} onApply={onPick && current ? onPick : undefined} onHover={onHover} last={last} deltas={win?.deltas} />
          <div className="picker-tools">
            <label className="champ-search">
              <Search size={15} aria-hidden />
              <input type="search" placeholder="Search champion…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search champion" />
            </label>
            <div className="chips" role="radiogroup" aria-label="Show champions">
              {(["all", "suggested", "theirs", "ours"] as Filter[]).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                  {f === "suggested" ? "Top 10" : f === "theirs" ? "Their pools" : f === "ours" ? "Our pools" : "All"}
                </button>
              ))}
            </div>
          </div>
          <div className="role-tabs" role="radiogroup" aria-label="Role">
            {ROLES.map((r) => (
              <button key={r} type="button" role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>
                {r === "all" ? "All roles" : ROLE_SHORT[r]}
              </button>
            ))}
          </div>
          <div className="grid-champs">
            {shown.map((c) => (
              <ChampIcon
                key={c}
                name={c}
                size={46}
                state={stateOf(c)}
                mark={markOf(c)}
                rank={rank.get(c)}
                onClick={onPick && current ? () => onPick(c) : undefined}
                onHover={onHover ? (h) => onHover(h ? c : null) : undefined}
                caption={c}
              />
            ))}
            {shown.length === 0 && <p className="muted">No champion matches.</p>}
          </div>
          <div className="picker-foot">
            <span className="legend-inline">
              <span className="champ-mark theirs static" /> their pools <span className="champ-mark ours static" /> our pools · numbered = co-pilot top 3
            </span>
            {onUndo && (
              <span>
                <button type="button" className="ghost" onClick={onUndo} disabled={step === 0}>
                  Undo
                </button>{" "}
                <button type="button" className="ghost" onClick={onClear}>
                  Clear game
                </button>
              </span>
            )}
          </div>
        </div>
        <TeamColumn ctx={ctx} game={game} side="red" calls={calls} meta={meta} />
      </div>
    </section>
  );
}
