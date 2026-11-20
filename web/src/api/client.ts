import { MOCK_BACKTEST, mockPlan } from "./fixtures";
import type { DraftBacktest, PlanQuery, SeriesPlanResponse } from "./types";

// Set VITE_API=live (and run `macrodna serve`) to use the real API; otherwise the app runs on synthetic data.
export const isLive = import.meta.env.VITE_API === "live";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().then((b: { detail?: string }) => b.detail).catch(() => undefined);
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

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
