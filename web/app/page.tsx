"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useDashboard } from "@/lib/useDashboard";
import { useReplay } from "@/lib/replay";
import type { DashboardPayload } from "@/lib/types";
import { API_BASE } from "@/lib/api";
import { PALETTE } from "@/lib/palette";
import UsMap, { type BaseRegion } from "@/components/UsMap";
import AgentGraph from "@/components/AgentGraph";
import LineageIntro from "@/components/intro/LineageIntro";
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
    return <CenterMessage title="Priming the canvas…" subtitle={`Reaching the agent at ${API_BASE}`} />;
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
  return <Experience data={load.data} />;
}

// Orchestrates the cold-open → live-room hand-off. The atomic swap between
// <LineageIntro> and <Dashboard> is what drives the shared layoutId="agent-core"
// morph; the live replay autoplays the moment the dashboard mounts.
function Experience({ data }: { data: DashboardPayload }) {
  const [decided, setDecided] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [canReplayIntro, setCanReplayIntro] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const force = params.get("intro") === "1";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem("seenIntro");
    setShowIntro(force || (!reduced && !seen));
    setCanReplayIntro(!reduced);
    setDecided(true);
  }, []);

  const finishIntro = () => {
    sessionStorage.setItem("seenIntro", "1");
    setShowIntro(false);
  };

  if (!decided) return <main className="min-h-screen" />;
  if (showIntro) return <LineageIntro data={data} onDone={finishIntro} />;
  return (
    <Dashboard
      data={data}
      onReplayIntro={canReplayIntro ? () => setShowIntro(true) : undefined}
    />
  );
}

type CenterView = "map" | "graph";

function Dashboard({
  data,
  onReplayIntro,
}: {
  data: DashboardPayload;
  onReplayIntro?: () => void;
}) {
  const replay = useReplay(data);
  const { state } = replay;
  const [view, setView] = useState<CenterView>("map");

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
    <motion.main
      className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-4 p-4 lg:p-6"
      initial={{ opacity: 0, scale: 1.03 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <Header
        undermedicated={data.overview.undermedicated}
        onReplayIntro={onReplayIntro}
      />

      {/* Hero scoreboard. */}
      <KpiBar state={state} evals={data.eval_summaries} />

      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* Center stage — map or decision graph, sharing the scrubber. */}
        <div className="flex flex-col gap-4">
          <div className="panel relative min-h-[420px] p-2 sm:p-4">
            <div className="pointer-events-none absolute left-5 top-4 z-10">
              <span className="placard">
                {view === "map" ? "Live allocation map" : "Agent decision graph"}
              </span>
              <p className="mt-1.5 text-[11px] text-faint">
                {view === "map"
                  ? "Agent → physician zip · arc width ∝ dollars"
                  : "Agent → physicians → patients · edge ∝ dollars"}
              </p>
            </div>
            <ViewToggle view={view} onChange={setView} />
            {view === "map" && <Legend />}
            {view === "map" ? (
              <UsMap state={state} baseRegions={baseRegions} />
            ) : (
              <AgentGraph state={state} />
            )}
          </div>
          <ReplayControls replay={replay} />
        </div>

        {/* Right rail. */}
        <div className="flex min-h-0 flex-col gap-4">
          <RegionBreakdown state={state} />
          <PersonFeed persons={state.persons} />
        </div>
      </div>

      {/* Bottom analytics row. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ToolEventFeed toolLog={state.toolLog} />
        <PolicyComparison evals={data.eval_summaries} />
        <TrainingCurve curve={data.training_curve} progress={state.progress} />
      </div>
    </motion.main>
  );
}

function Header({
  undermedicated,
  onReplayIntro,
}: {
  undermedicated: number;
  onReplayIntro?: () => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/12 ring-1 ring-gold/30">
          <svg width="16" height="16" viewBox="0 0 16 16" fill={PALETTE.gold} aria-hidden>
            <path d="M8 1 L15 8 L8 15 L1 8 Z" />
          </svg>
        </div>
        <div>
          <h1 className="font-serif text-xl font-semibold tracking-tight text-ink">
            Agent Sponsorship HUD
          </h1>
          <p className="text-[11px] text-muted">
            An RL agent funds physicians to medicate{" "}
            <span className="text-ink">{undermedicated.toLocaleString()}</span> under-medicated
            patients — for less than the baselines.
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onReplayIntro && (
          <button
            onClick={onReplayIntro}
            className="rounded-full border border-hairline bg-canvas-2 px-3 py-1.5 text-xs text-muted transition hover:text-ink"
          >
            ↺ Replay intro
          </button>
        )}
        <span className="flex items-center gap-2 rounded-full border border-hairline bg-canvas-2 px-3 py-1.5 text-xs text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
          </span>
          Replaying production rounds
        </span>
      </div>
    </header>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: CenterView;
  onChange: (v: CenterView) => void;
}) {
  const opts: [CenterView, string][] = [
    ["map", "Map"],
    ["graph", "Graph"],
  ];
  return (
    <div className="absolute right-4 top-4 z-10 flex items-center gap-0.5 rounded-full border border-hairline bg-canvas-2 p-0.5">
      {opts.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide transition ${
            view === v ? "bg-gold text-canvas" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [
    [PALETTE.emerald, "medicated"],
    [PALETTE.slate, "funded · didn't convert"],
    [PALETTE.gold, "the agent"],
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 left-5 z-10 flex flex-wrap gap-3">
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
      <div className="panel ink-bleed flex flex-col items-center gap-2 px-10 py-8 text-center">
        <span className="relative flex h-3 w-3">
          {!error && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75 motion-reduce:hidden" />
          )}
          <span
            className="relative inline-flex h-3 w-3 rounded-full"
            style={{ background: error ? PALETTE.danger : PALETTE.gold }}
          />
        </span>
        <h1 className="font-serif text-lg font-semibold text-ink">{title}</h1>
        {subtitle && <p className="max-w-sm text-xs text-muted">{subtitle}</p>}
      </div>
    </main>
  );
}
