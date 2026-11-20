// Cursor over a finished real series, for replaying its drafts step by step.
import type { SeriesDraft } from "../api/types";
import { ORDER, type GameDraft } from "./draft";

export interface ReplayState {
  draft: SeriesDraft;
  truth: GameDraft[];
  gi: number; // game being shown
  step: number; // steps of that game revealed (0..20)
  playing: boolean;
}

/** The series' real drafts as board games, with "us" = the first team of the summary. */
export function truthOf(draft: SeriesDraft): GameDraft[] {
  const ours = draft.series.teams[0]?.team_id;
  return draft.games.map((g, i) => ({
    number: i + 1,
    ourSide: g.blue_team_id === ours ? "blue" : "red",
    steps: g.steps,
    winner: g.winner_team_id ? (g.winner_team_id === ours ? "us" : "them") : null,
  }));
}

/** Move the cursor by `delta` steps, rolling over into the next or previous game. */
export function advanceReplay(r: ReplayState, delta: number): ReplayState {
  let { gi, step } = r;
  step += delta;
  if (step > ORDER.length) {
    if (gi + 1 < r.truth.length) {
      gi += 1;
      step = 0;
    } else {
      return { ...r, step: ORDER.length, playing: false };
    }
  }
  if (step < 0) {
    if (gi > 0) {
      gi -= 1;
      step = ORDER.length;
    } else step = 0;
  }
  return { ...r, gi, step };
}
