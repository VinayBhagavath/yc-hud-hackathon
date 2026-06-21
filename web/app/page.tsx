"use client";

import { useMemo } from "react";
import { useDashboard } from "@/lib/useDashboard";
import { useReplay } from "@/lib/replay";
import type { DashboardPayload } from "@/lib/types";
import { API_BASE } from "@/lib/api";
import UsMap, { type BaseRegion } from "@/components/UsMap";
import KpiBar from "@/components/KpiBar";
import RegionBreakdown from "@/components/RegionBreakdown";
import PersonFeed from "@/components/PersonFeed";
import ToolEventFeed from "@/components/ToolEventFeed";
import ReplayControls from "@/components/ReplayControls";
import PolicyComparison from "@/components/PolicyComparison";
import TrainingCurve from "@/components/TrainingCurve";

export default function Page() {
  const load = useDashboard();

  if (load.status === "loading") {
    return <CenterMessage title="Connecting to the agent…" subtitle={API_BASE} />;
  }
  if (load.status === "error") {
    return (
      <CenterMessage
        title="Can't reach the HUD API"
        subtitle={`${load.error} · is uvicorn running on ${API_BASE}?`}
        error
      />
    );
  }
  return <Dashboard data={load.data} />;
}

function Dashboard({ data }: { data: DashboardPayload }) {
  const replay = useReplay(data);
  const { state } = replay;

  const baseRegions = useMemo<BaseRegion[]>(() => {
    const panelByRegion = new Map(
      data.overview.region_buckets.map((r) => [r.label, r.patient_count]),
    );
    const seen = new Map<string, BaseRegion>();
    for (const p of data.physicians) {
      if (seen.has(p.region) || p.lat == null || p.lon == null) continue;
      seen.set(p.region, {
        region: p.region,
        city: p.city ?? p.region,
        lat: p.lat,
        lon: p.lon,
        panel: panelByRegion.get(p.region) ?? 0,
      });
    }
    return [...seen.values()];
  }, [data]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
      <Header total={data.overview.total_patients} />

      <KpiBar state={state} evals={data.eval_summaries} />

      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Map column */}
        <div className="flex flex-col gap-4">
          <div className="panel relative overflow-hidden p-2 sm:p-4">
            <div className="pointer-events-none absolute left-5 top-4 z-10">
              <h2 className="text-sm font-semibold text-ink">Live allocation map</h2>
              <p className="text-[11px] text-muted">
                Agent → physician zip · arc width ∝ dollars
              </p>
            </div>
            <Legend />
            <UsMap state={state} baseRegions={baseRegions} />
          </div>
          <ReplayControls replay={replay} />
        </div>

        {/* Right rail */}
        <div className="flex min-h-0 flex-col gap-4">
          <RegionBreakdown state={state} />
          <PersonFeed persons={state.persons} />
        </div>
      </div>

      {/* Bottom analytics row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ToolEventFeed toolLog={state.toolLog} />
        <PolicyComparison evals={data.eval_summaries} />
        <TrainingCurve curve={data.training_curve} />
      </div>
    </main>
  );
}

function Header({ total }: { total: number }) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-money/15 ring-1 ring-money/30">
          <span className="text-money">◈</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Agent Sponsorship HUD
          </h1>
          <p className="text-[11px] text-muted">
            RL agent allocating sponsorship dollars across {total} patients
          </p>
        </div>
      </div>
      <span className="flex items-center gap-2 rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs text-muted">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-money opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-money" />
        </span>
        Replaying production rounds
      </span>
    </header>
  );
}

function Legend() {
  const items: [string, string][] = [
    ["#34d399", "medicated"],
    ["#7c8499", "funded · no convert"],
    ["#fbbf24", "organic"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 left-5 z-10 flex gap-3">
      {items.map(([c, label]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: c }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function CenterMessage({
  title,
  subtitle,
  error,
}: {
  title: string;
  subtitle?: string;
  error?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel flex flex-col items-center gap-2 px-10 py-8 text-center">
        <span
          className={`relative flex h-3 w-3 ${error ? "text-danger" : "text-money"}`}
        >
          {!error && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-money opacity-75" />
          )}
          <span
            className="relative inline-flex h-3 w-3 rounded-full"
            style={{ background: error ? "#f87171" : "#34d399" }}
          />
        </span>
        <h1 className="text-base font-semibold text-ink">{title}</h1>
        {subtitle && <p className="max-w-sm text-xs text-muted">{subtitle}</p>}
      </div>
    </main>
  );
}
