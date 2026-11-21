import { DEMO_REPLAY_ID, demoReplay } from "../demo/replay";
import { DEMO_TEAMS, demoEvidence, demoProfile, demoTendencies } from "../demo/scouting";
import { DEMO_META, DEMO_SERIES, DEMO_SERIES_LIST, DEMO_WIN_MODEL, demoSeriesDraft } from "../demo/series";
import type { SeriesContext } from "../lib/draft";
import { MOCK_BACKTEST, mockPlan } from "./fixtures";
import type {
  ChampionStats,
  DraftBacktest,
  EvidenceItem,
  PlanQuery,
  Replay,
  SeriesDraft,
  SeriesPlanResponse,
  SeriesSummary,
  TeamDraftTendencies,
  TeamLogos,
  TeamProfile,
  TeamSummary,
  TendencyScope,
  WinModel,
} from "./types";

// Set VITE_API=live (and run `lockout serve`) to use the real API; otherwise the app runs on synthetic data.
export const isLive = import.meta.env.VITE_API === "live";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().then((b: { detail?: string }) => b.detail).catch(() => undefined);
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
const demo = <T>(value: () => T): Promise<T> => new Promise((resolve, reject) => {
  try {
    resolve(value());
  } catch (e) {
    reject(e);
  }
});

export async function fetchPlan(q: PlanQuery): Promise<SeriesPlanResponse> {
  if (!isLive) return mockPlan(q);
  const params = new URLSearchParams({
    team: q.team,
    opponent: q.opponent,
    locked: q.locked.join(","),
    banned: q.banned.join(","),
  });
  return getJson<SeriesPlanResponse>(`/api/draft/plan?${params}`);
}

export async function fetchBacktest(): Promise<DraftBacktest> {
  return isLive ? getJson<DraftBacktest>("/api/draft/backtest") : MOCK_BACKTEST;
}

/** Teams, player pools, the opponent's recent drafts and jungle bridges. Games of the live series are entered by the coach. */
export async function fetchContext(team = "", opponent = ""): Promise<SeriesContext> {
  if (!isLive) return DEMO_SERIES;
  const params = new URLSearchParams({ team, opponent });
  const ctx = await getJson<Omit<SeriesContext, "games">>(`/api/series/context?${params}`);
  return { ...ctx, games: [] };
}

/** Team logo URLs by name; never fails (the UI falls back to monograms). Demo teams are fictional, so none. */
export const fetchLogos = (): Promise<Record<string, string>> =>
  isLive ? getJson<TeamLogos>("/api/logos").then((r) => r.logos).catch(() => ({})) : Promise.resolve({});

export const fetchTeams = (): Promise<TeamSummary[]> => (isLive ? getJson<TeamSummary[]>("/api/teams") : demo(() => DEMO_TEAMS));

export function fetchProfile(teamId: string, event: string | null = null): Promise<TeamProfile> {
  if (!isLive) return demo(() => demoProfile(teamId, event));
  return getJson<TeamProfile>(`/api/teams/${enc(teamId)}/profile${event ? `?event=${enc(event)}` : ""}`);
}

export const fetchEvidence = (teamId: string, templateId: string): Promise<EvidenceItem[]> =>
  isLive ? getJson<EvidenceItem[]>(`/api/teams/${enc(teamId)}/tells/${enc(templateId)}/evidence`) : demo(() => demoEvidence(teamId, templateId));

export const fetchTendencies = (teamId: string, scope: TendencyScope = "all"): Promise<TeamDraftTendencies> =>
  isLive ? getJson<TeamDraftTendencies>(`/api/teams/${enc(teamId)}/draft-tendencies?scope=${scope}`) : demo(() => demoTendencies(teamId, scope));

/** A game's positions and key events. In demo mode every id opens the same synthetic replay. */
export const fetchReplay = (gameId: string): Promise<Replay> => (isLive ? getJson<Replay>(`/api/games/${enc(gameId)}/replay`) : demo(demoReplay));

export const DEMO_GAME_ID = DEMO_REPLAY_ID;

/** League meta per champion (90 days). Never fails: the co-pilot falls back to pools only. */
export const fetchChampions = (): Promise<ChampionStats[]> =>
  isLive ? getJson<ChampionStats[]>("/api/champions").catch(() => []) : Promise.resolve(DEMO_META);

/** Finished real series, newest first, for a team (and optionally its opponent). */
export function fetchSeriesList(team: string, opponent = ""): Promise<SeriesSummary[]> {
  if (!isLive) return Promise.resolve(DEMO_SERIES_LIST);
  const params = new URLSearchParams({ team, limit: "40" });
  if (opponent) params.set("opponent", opponent);
  return getJson<SeriesSummary[]>(`/api/series?${params}`);
}

/** A real series' drafts plus the context as it was before game 1. */
export const fetchSeriesDraft = (seriesId: string, ours = ""): Promise<SeriesDraft> =>
  isLive ? getJson<SeriesDraft>(`/api/series/${enc(seriesId)}/draft${ours ? `?ours=${enc(ours)}` : ""}`) : demo(demoSeriesDraft);

/** The live-draft win model for a matchup, fitted on games before `before` (ISO). Null if unavailable. */
export function fetchWinModel(team: string, opponent: string, before?: string): Promise<WinModel | null> {
  if (!isLive) return Promise.resolve({ ...DEMO_WIN_MODEL, ours_id: team || "alpha", opponent_id: opponent || "bravo" });
  const params = new URLSearchParams({ team, opponent });
  if (before) params.set("before", before);
  return getJson<WinModel>(`/api/draft/win-model?${params}`).catch(() => null);
}
