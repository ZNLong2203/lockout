import { useEffect, useState, type FormEvent } from "react";
import { DEMO_GAME_ID, fetchReplay, isLive } from "../api/client";
import type { Replay } from "../api/types";
import { replayLink } from "../lib/route";
import { ReplayPlayer } from "./ReplayPlayer";

/** The 2D replay of one game, opened from the evidence behind a tell or by game id. */
export function ReplayPage({ gameId, startAt }: { gameId: string | null; startAt: number }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    setReplay(null);
    setError(null);
    if (!gameId) return;
    let alive = true;
    fetchReplay(gameId)
      .then((r) => alive && setReplay(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the replay"));
    return () => {
      alive = false;
    };
  }, [gameId]);

  const open = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) window.location.hash = replayLink(draft.trim());
  };

  return (
    <main className="app">
      <section className="card" aria-label="Replay">
        <h2>2D replay</h2>
        <p className="sub">
          Every player once per second, drawn on our own map. Open it from the games behind a tell on the Scouting page, or enter a game id.
          {!isLive && " In demo mode every game opens the same synthetic replay."}
        </p>
        <form className="inline-form" onSubmit={open}>
          <label>
            Game id
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={isLive ? "paste a game id" : DEMO_GAME_ID} />
          </label>
          <button type="submit">Open</button>
          {!isLive && (
            <a className="btn-link" href={replayLink(DEMO_GAME_ID)}>
              Open the demo replay
            </a>
          )}
        </form>
      </section>
      {gameId && !replay && !error && <p className="muted">Loading the replay…</p>}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {replay && (
        <section className="card" aria-label={`Game ${replay.game_id}`}>
          <div className="replay-head">
            <h2>
              {replay.blue_team} <span className="muted">vs</span> {replay.red_team}
            </h2>
            <span className="muted">
              game {replay.game_id} · series {replay.series_id}
            </span>
          </div>
          <ReplayPlayer replay={replay} startAt={startAt} />
        </section>
      )}
    </main>
  );
}
