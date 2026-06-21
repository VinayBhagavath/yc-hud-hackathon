import type { DashboardPayload } from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export async function fetchDashboard(
  signal?: AbortSignal,
): Promise<DashboardPayload> {
  const res = await fetch(`${API_BASE}/api/dashboard`, {
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Dashboard request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as DashboardPayload;
}
