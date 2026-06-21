"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchDashboard } from "./api";
import { buildDemoDashboard } from "./demoData";
import type { DashboardPayload } from "./types";

export type DataSource = "demo" | "live";

export type SourceState =
  | { status: "loading"; source: DataSource }
  | { status: "error"; error: string; source: DataSource }
  | { status: "ready"; data: DashboardPayload; source: DataSource };

// Chooses the dataset that backs the HUD. The live agent only emits a tiny
// placeholder cohort, so the demo (large synthetic dataset) is the default
// showcase; ?live=1 pulls the real backend instead. useDashboard stays intact.
export function useDataSource(): SourceState {
  const source: DataSource = useMemo(() => {
    if (typeof window === "undefined") return "demo";
    return new URLSearchParams(window.location.search).get("live") === "1" ? "live" : "demo";
  }, []);

  const demo = useMemo(() => (source === "demo" ? buildDemoDashboard() : null), [source]);
  const [state, setState] = useState<SourceState>(() =>
    source === "demo" && demo
      ? { status: "ready", data: demo, source }
      : { status: "loading", source },
  );

  useEffect(() => {
    if (source === "demo") return;
    const controller = new AbortController();
    fetchDashboard(controller.signal)
      .then((data) => setState({ status: "ready", data, source }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
          source,
        });
      });
    return () => controller.abort();
  }, [source]);

  return state;
}
