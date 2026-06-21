"use client";

import { useEffect, useState } from "react";
import { fetchDashboard } from "./api";
import type { DashboardPayload } from "./types";

export type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: DashboardPayload };

export function useDashboard(): LoadState {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchDashboard(controller.signal)
      .then((data) => setState({ status: "ready", data }))
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      });
    return () => controller.abort();
  }, []);

  return state;
}
