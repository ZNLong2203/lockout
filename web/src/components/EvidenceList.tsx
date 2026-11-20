import { useEffect, useState } from "react";
import { fetchEvidence } from "../api/client";
import type { EvidenceItem } from "../api/types";
import { clock } from "../lib/draft";
import { replayLink } from "../lib/route";

/** Every occurrence behind a tell: the game, the moment it was triggered, whether the team did what the tell says. */
export function EvidenceList({ teamId, templateId }: { teamId: string; templateId: string }) {
  const [items, setItems] = useState<EvidenceItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchEvidence(teamId, templateId)
      .then((r) => alive && setItems(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : "Could not load the evidence"));
    return () => {
      alive = false;
    };
  }, [teamId, templateId]);

  if (error) return <p className="err" role="alert">{error}</p>;
  if (!items) return <p className="muted">Loading the games…</p>;
  return (
    <div className="evidence">
      <table>
        <caption className="sr-only">Games behind this tell, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Opponent</th>
            <th scope="col">Side</th>
            <th scope="col">Triggered</th>
            <th scope="col">Result</th>
            <th scope="col">Replay</th>
          </tr>
        </thead>
        <tbody>
          {items.map((e) => (
            <tr key={`${e.game_id}-${e.t_trigger}`}>
              <td>{e.date}</td>
              <td>{e.opponent}</td>
              <td>
                <span className={`side-dot ${e.side}`} aria-hidden /> {e.side}
              </td>
              <td className="num">{clock(e.t_trigger)}</td>
              <td>
                <span className={`result ${e.hit ? "us" : "them"}`}>{e.hit ? "Did it" : "Did not"}</span>
                {e.hit && e.t_outcome !== null && <span className="muted"> at {clock(e.t_outcome)}</span>}
              </td>
              <td>
                <a href={replayLink(e.game_id, Math.max(e.t_trigger - 10, 0))}>Open at {clock(Math.max(e.t_trigger - 10, 0))}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {items.length} occurrence{items.length === 1 ? "" : "s"}, game ids {items.slice(0, 3).map((e) => e.game_id).join(", ")}
        {items.length > 3 ? ", …" : ""}
      </p>
    </div>
  );
}
