"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useDataSource, type DataSource } from "@/lib/useDataSource";
import { useReplay } from "@/lib/replay";
import type { ReplayState, RegionAgg } from "@/lib/replay";
import type { DashboardPayload } from "@/lib/types";
import { API_BASE } from "@/lib/api";
import { PALETTE } from "@/lib/palette";
import UsMap, { type BaseRegion } from "@/components/UsMap";
import AgentGraph, { type GraphPhysician } from "@/components/AgentGraph";
import LineageIntro from "@/components/intro/LineageIntro";
import KpiBar from "@/components/KpiBar";
import RegionBreakdown from "@/components/RegionBreakdown";
import PersonFeed from "@/components/PersonFeed";
import ToolEventFeed from "@/components/ToolEventFeed";
import ReplayControls from "@/components/ReplayControls";
import PolicyComparison from "@/components/PolicyComparison";
import TrainingCurve from "@/components/TrainingCurve";

export default function Page() {
  const load = useDataSource();

  if (load.status === "loading") {
    return <CenterMessage title="Priming the canvas…" subtitle={`Reaching the agent at ${API_BASE}`} />;
  }
  if (load.status === "error") {
    return (
      <CenterMessage
        title="Can't reach the HUD API"
        subtitle={`${load.error} · is uvicorn running on ${API_BASE}? Drop ?live=1 to see the demo.`}
        error
      />
    );
  }
  return <Experience data={load.data} source={load.source} />;
}

// Orchestrates the cold-open → live-room hand-off. The atomic swap between
// <LineageIntro> and <Dashboard> drives the shared layoutId="agent-core" morph.
function Experience({ data, source }: { data: DashboardPayload; source: DataSource }) {
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
      source={source}
      onReplayIntro={canReplayIntro ? () => setShowIntro(true) : undefined}
    />
  );
}

type CenterView = "map" | "graph" | "model";

// Trained model's provider ranking + money allocation (GET /api/model-allocation).
interface ModelAllocation {
  model: string;
  budget: number;
  total_converted: number;
  n_total: number;
  total_spend: number;
  ranking: {
    rank: number;
    provider_id: number;
    region: string;
    allocation_usd: number;
    n_patients: number;
    converted: number;
    funded: boolean;
  }[];
  baseRegions: { region: string; lat: number; lon: number }[];
  byRegion: { region: string; funded: number; medicated: number; spend: number }[];
}

function Dashboard({
  data,
  source,
  onReplayIntro,
}: {
  data: DashboardPayload;
  source: DataSource;
  onReplayIntro?: () => void;
}) {
  const replay = useReplay(data);
  const { state } = replay;
  const [view, setView] = useState<CenterView>("map");

  // Trained model's allocation, fetched once from the backend.
  const [modelAlloc, setModelAlloc] = useState<ModelAllocation | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${API_BASE}/api/model-allocation`, { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ModelAllocation>) : null))
      .then((d) => setModelAlloc(d))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const modelBaseRegions = useMemo<BaseRegion[]>(() => {
    if (!modelAlloc) return [];
    const panel = new Map(modelAlloc.ranking.map((r) => [r.region, r.n_patients]));
    return modelAlloc.baseRegions.map((b) => ({
      region: b.region, city: b.region, lat: b.lat, lon: b.lon, panel: panel.get(b.region) ?? 0,
    }));
  }, [modelAlloc]);

  const modelState = useMemo<ReplayState | null>(() => {
    if (!modelAlloc) return null;
    const geo = new Map(modelAlloc.baseRegions.map((b) => [b.region, b]));
    const panel = new Map(modelAlloc.ranking.map((r) => [r.region, r.n_patients]));
    const byRegion: RegionAgg[] = modelAlloc.byRegion.map((r) => ({
      region: r.region, city: r.region,
      lat: geo.get(r.region)?.lat ?? 0, lon: geo.get(r.region)?.lon ?? 0,
      spend: r.spend, funded: r.funded, medicated: r.medicated,
      people: r.funded, panel: panel.get(r.region) ?? 0,
    }));
    return {
      roundIndex: 0, roundId: "model", totalRounds: 1, budgetTotal: modelAlloc.budget,
      spend: modelAlloc.total_spend, fundedCount: modelAlloc.total_converted,
      peopleReached: modelAlloc.total_converted, medicatedCount: modelAlloc.total_converted,
      organicCount: 0,
      costPerMedicated: modelAlloc.total_converted ? modelAlloc.total_spend / modelAlloc.total_converted : null,
      conversionRate: 1, byRegion, flows: [], persons: [], toolLog: [],
      latestKind: "start", progress: 1,
    };
  }, [modelAlloc]);

  const baseRegions = useMemo<BaseRegion[]>(() => {
    const panelByRegion = new Map(data.overview.region_buckets.map((r) => [r.label, r.patient_count]));
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

  const graphPhysicians = useMemo<GraphPhysician[]>(
    () =>
      data.physicians.map((p) => ({
        physician_id: p.physician_id,
        region: p.region,
        city: p.city ?? p.region,
        specialty: p.specialty,
      })),
    [data],
  );

  return (
    <motion.main
      className="mx-auto flex min-h-screen max-w-[1680px] flex-col gap-6 p-5 lg:p-7"
      initial={{ opacity: 0, scale: 1.02 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: "easeOut" }}
    >
      <Header
        physicians={data.physicians.length}
        metros={baseRegions.length}
        source={source}
        onReplayIntro={onReplayIntro}
      />

      <KpiBar state={state} evals={data.eval_summaries} />

      <div className="grid grid-cols-1 gap-6 xl:h-[700px] xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* Center stage. */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="panel relative flex min-h-[460px] flex-1 flex-col p-3 sm:p-5">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="placard">
                  {view === "map"
                    ? "Live allocation map"
                    : view === "graph"
                      ? "Agent decision graph"
                      : "Trained model allocation"}
                </span>
                <p className="mt-1.5 text-[11px] text-faint">
                  {view === "map"
                    ? "Agent → physician metro · arc width ∝ dollars · node grows with spend"
                    : view === "graph"
                      ? "Agent → physicians → patients · edge ∝ dollars · colour ∝ outcome"
                      : "Trained model's provider ranking · node grows with $ allocated · green = funded"}
                </p>
              </div>
              <ViewToggle view={view} onChange={setView} />
            </div>
            <div className="relative flex min-h-0 flex-1 items-center overflow-hidden">
              {view === "map" ? (
                <UsMap state={state} baseRegions={baseRegions} />
              ) : view === "graph" ? (
                <AgentGraph state={state} physicians={graphPhysicians} />
              ) : modelState ? (
                <ModelMap state={modelState} baseRegions={modelBaseRegions} ranking={modelAlloc!.ranking} />
              ) : (
                <div className="m-auto text-[12px] text-faint">Loading model allocation… (is the API running?)</div>
              )}
            </div>
            <Legend />
          </div>
          <ReplayControls replay={replay} />
        </div>

        {/* Right rail. */}
        <div className="flex min-h-0 flex-col gap-6">
          <RegionBreakdown state={state} />
          <PersonFeed persons={state.persons} />
        </div>
      </div>

      {/* Bottom analytics row. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <ToolEventFeed toolLog={state.toolLog} />
        <PolicyComparison evals={data.eval_summaries} />
        <TrainingCurve curve={data.training_curve} progress={state.progress} />
      </div>
    </motion.main>
  );
}

function Header({
  physicians,
  metros,
  source,
  onReplayIntro,
}: {
  physicians: number;
  metros: number;
  source: DataSource;
  onReplayIntro?: () => void;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold/12 ring-1 ring-gold/30">
          <svg width="17" height="17" viewBox="0 0 16 16" fill={PALETTE.gold} aria-hidden>
            <path d="M8 1 L15 8 L8 15 L1 8 Z" />
          </svg>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-placard text-gold/80">
            Reinforcement-learned sponsorship allocation
          </span>
          <h1 className="text-balance font-serif text-2xl font-semibold leading-[1.05] tracking-tight text-ink">
            Agent Sponsorship HUD
          </h1>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <SourceChip source={source} />
        {onReplayIntro && (
          <button
            onClick={onReplayIntro}
            className="rounded-full border border-hairline bg-canvas-2 px-3 py-1.5 text-xs text-muted transition hover:text-ink"
          >
            ↺ Replay intro
          </button>
        )}
        <span className="hidden items-center gap-2 rounded-full border border-hairline bg-canvas-2 px-3 py-1.5 text-xs text-muted sm:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald" />
          </span>
          {physicians} physicians · {metros} metros
        </span>
      </div>
    </header>
  );
}

function SourceChip({ source }: { source: DataSource }) {
  const live = source === "live";
  return (
    <a
      href={live ? "/" : "/?live=1"}
      title={live ? "Showing live agent data — click for the demo" : "Showing the synthetic demo — click for live agent data"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        live
          ? "border-emerald/40 bg-emerald/10 text-emerald hover:brightness-110"
          : "border-gold/40 bg-gold/10 text-gold hover:brightness-110"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald" : "bg-gold"}`} />
      {live ? "Live data" : "Synthetic demo"}
    </a>
  );
}

// The trained model's allocation on the same US map, plus a ranking overlay.
function ModelMap({
  state,
  baseRegions,
  ranking,
}: {
  state: ReplayState;
  baseRegions: BaseRegion[];
  ranking: ModelAllocation["ranking"];
}) {
  return (
    <div className="relative h-full w-full">
      <UsMap state={state} baseRegions={baseRegions} />
      <div
        className="absolute right-2 top-2 max-h-[92%] w-[230px] overflow-auto rounded-lg border border-hairline bg-canvas-2/90 p-2.5 text-[11px] backdrop-blur"
        style={{ pointerEvents: "auto" }}
      >
        <div className="mb-1.5 font-medium text-ink">
          Model ranking · ${state.spend.toFixed(0)} → {state.medicatedCount} on therapy
        </div>
        {ranking.map((r) => (
          <div
            key={r.provider_id}
            className="flex justify-between gap-2 py-0.5"
            style={{ color: r.funded ? PALETTE.emerald : PALETTE.faint }}
          >
            <span className="truncate">#{r.rank} {r.region}</span>
            <span className="shrink-0 tabular-nums">
              {r.funded ? `$${r.allocation_usd.toFixed(0)} · ${r.converted}✓` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: CenterView; onChange: (v: CenterView) => void }) {
  const opts: [CenterView, string][] = [
    ["map", "Map"],
    ["graph", "Graph"],
    ["model", "Model"],
  ];
  return (
    <div className="z-10 flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-canvas-2 p-0.5">
      {opts.map(([v, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-full px-3.5 py-1 text-[11px] font-semibold tracking-wide transition ${
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
    <div className="pointer-events-none absolute bottom-4 left-5 z-10 flex flex-wrap gap-3.5">
      {items.map(([c, label]) => (
        <span key={label} className="flex items-center gap-1.5 text-[11px] text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: c }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function CenterMessage({ title, subtitle, error }: { title: string; subtitle?: string; error?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="panel ink-bleed flex flex-col items-center gap-2 px-10 py-8 text-center">
        <span className="relative flex h-3 w-3">
          {!error && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold opacity-75 motion-reduce:hidden" />
          )}
          <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: error ? PALETTE.danger : PALETTE.gold }} />
        </span>
        <h1 className="font-serif text-lg font-semibold text-ink">{title}</h1>
        {subtitle && <p className="max-w-sm text-xs text-muted">{subtitle}</p>}
      </div>
    </main>
  );
}
