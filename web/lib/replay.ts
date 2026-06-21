"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DashboardPayload,
  FundingOutcome,
  Outcome,
  PhysicianView,
  ToolEvent,
} from "./types";

// ---------------------------------------------------------------------------
// Timeline model
// ---------------------------------------------------------------------------

export type ReplayEvent =
  | {
      kind: "round";
      roundIndex: number;
      roundId: string;
      startedPool: number;
      budgetTotal: number;
    }
  | { kind: "tool"; roundIndex: number; roundId: string; tool: ToolEvent }
  | {
      kind: "allocate";
      roundIndex: number;
      roundId: string;
      tool: ToolEvent;
      outcome: FundingOutcome;
    }
  | { kind: "skip"; roundIndex: number; roundId: string; outcome: FundingOutcome };

export interface PhysicianGeo {
  physicianId: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
}

export interface FlowItem {
  key: string;
  eventIndex: number;
  physicianId: string;
  region: string;
  city: string;
  lat: number;
  lon: number;
  amount: number;
  outcome: Outcome;
  patientId: string;
}

export interface RegionAgg {
  region: string;
  city: string;
  lat: number;
  lon: number;
  spend: number;
  funded: number;
  medicated: number;
  people: number; // distinct funded patients
  panel: number; // total patients in region (context)
}

export interface PersonItem {
  key: string;
  patientId: string;
  physicianId: string;
  region: string;
  city: string;
  diagnosis: string;
  amount: number;
  outcome: Outcome;
  roundId: string;
}

export interface ToolLogItem {
  key: string;
  roundId: string;
  tool: ToolEvent;
}

export interface ReplayState {
  roundIndex: number;
  roundId: string;
  totalRounds: number;
  budgetTotal: number;
  spend: number;
  fundedCount: number;
  peopleReached: number;
  medicatedCount: number;
  organicCount: number;
  costPerMedicated: number | null;
  conversionRate: number; // medicated / funded
  byRegion: RegionAgg[];
  flows: FlowItem[];
  persons: PersonItem[]; // newest first
  toolLog: ToolLogItem[]; // newest first
  latestKind: ReplayEvent["kind"] | "start";
  progress: number; // 0..1
}

export interface ReplayLookups {
  geoById: Map<string, PhysicianGeo>;
  panelByRegion: Map<string, number>;
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function geoFromPhysician(p: PhysicianView): PhysicianGeo {
  return {
    physicianId: p.physician_id,
    region: p.region,
    city: p.city ?? p.region,
    lat: p.lat ?? 0,
    lon: p.lon ?? 0,
  };
}

export function buildLookups(dashboard: DashboardPayload): ReplayLookups {
  const geoById = new Map<string, PhysicianGeo>();
  for (const p of dashboard.physicians) geoById.set(p.physician_id, geoFromPhysician(p));

  const panelByRegion = new Map<string, number>();
  for (const r of dashboard.overview.region_buckets) {
    panelByRegion.set(r.label, r.patient_count);
  }
  return { geoById, panelByRegion };
}

export function buildTimeline(dashboard: DashboardPayload): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  dashboard.playback.forEach((round, roundIndex) => {
    events.push({
      kind: "round",
      roundIndex,
      roundId: round.round_id,
      startedPool: round.started_pool,
      budgetTotal: round.budget.budget_total_usd,
    });

    const fundedByPatient = new Map<string, FundingOutcome>();
    for (const f of round.funded) fundedByPatient.set(f.patient_id, f);
    const emitted = new Set<string>();

    for (const tool of round.tool_events) {
      if (tool.tool_name === "allocate_funding" && tool.patient_id) {
        const outcome = fundedByPatient.get(tool.patient_id);
        if (outcome) {
          emitted.add(tool.patient_id);
          events.push({ kind: "allocate", roundIndex, roundId: round.round_id, tool, outcome });
          continue;
        }
      }
      events.push({ kind: "tool", roundIndex, roundId: round.round_id, tool });
    }

    // Any funded allocation without a matching tool event still gets a flow.
    for (const f of round.funded) {
      if (emitted.has(f.patient_id)) continue;
      events.push({
        kind: "allocate",
        roundIndex,
        roundId: round.round_id,
        tool: {
          tool_name: "allocate_funding",
          status: "queued",
          detail: `Fund ${f.patient_id}`,
          amount_usd: f.amount_usd,
          patient_id: f.patient_id,
        },
        outcome: f,
      });
    }

    // Organic conversions among skipped patients — money did not flow, but they
    // still surface in the person feed as organic medications.
    for (const s of round.skipped) {
      if (s.outcome === "organic_medicated") {
        events.push({ kind: "skip", roundIndex, roundId: round.round_id, outcome: s });
      }
    }
  });
  return events;
}

// ---------------------------------------------------------------------------
// Pure state reducer — recomputed from scratch up to `index` (data is small,
// so this keeps scrubbing trivial and the engine stateless/deterministic).
// ---------------------------------------------------------------------------

export function computeState(
  events: ReplayEvent[],
  index: number,
  lookups: ReplayLookups,
  totalRounds: number,
): ReplayState {
  const upTo = Math.min(index, events.length - 1);
  const regionMap = new Map<string, RegionAgg>();
  const flows: FlowItem[] = [];
  const persons: PersonItem[] = [];
  const toolLog: ToolLogItem[] = [];

  let spend = 0;
  let fundedCount = 0;
  let medicatedCount = 0;
  let organicCount = 0;
  let roundIndex = 0;
  let roundId = events[0]?.kind === "round" ? events[0].roundId : "—";
  let budgetTotal = 0;
  let latestKind: ReplayState["latestKind"] = "start";

  const ensureRegion = (geo: PhysicianGeo): RegionAgg => {
    let agg = regionMap.get(geo.region);
    if (!agg) {
      agg = {
        region: geo.region,
        city: geo.city,
        lat: geo.lat,
        lon: geo.lon,
        spend: 0,
        funded: 0,
        medicated: 0,
        people: 0,
        panel: lookups.panelByRegion.get(geo.region) ?? 0,
      };
      regionMap.set(geo.region, agg);
    }
    return agg;
  };

  for (let i = 0; i <= upTo && i < events.length; i++) {
    const ev = events[i];
    latestKind = ev.kind;
    if (ev.kind === "round") {
      roundIndex = ev.roundIndex;
      roundId = ev.roundId;
      budgetTotal = ev.budgetTotal;
      continue;
    }
    if (ev.kind === "tool") {
      toolLog.push({ key: `t-${i}`, roundId: ev.roundId, tool: ev.tool });
      continue;
    }
    if (ev.kind === "allocate") {
      const geo = lookups.geoById.get(ev.outcome.physician_id);
      const region = geo?.region ?? ev.outcome.physician_region;
      const fallback: PhysicianGeo = geo ?? {
        physicianId: ev.outcome.physician_id,
        region,
        city: region,
        lat: 0,
        lon: 0,
      };
      const agg = ensureRegion(fallback);
      agg.spend += ev.outcome.amount_usd;
      agg.funded += 1;
      agg.people += 1;
      if (ev.outcome.outcome === "medicated") agg.medicated += 1;

      spend += ev.outcome.amount_usd;
      fundedCount += 1;
      if (ev.outcome.outcome === "medicated") medicatedCount += 1;

      flows.push({
        key: `f-${i}`,
        eventIndex: i,
        physicianId: ev.outcome.physician_id,
        region: fallback.region,
        city: fallback.city,
        lat: fallback.lat,
        lon: fallback.lon,
        amount: ev.outcome.amount_usd,
        outcome: ev.outcome.outcome,
        patientId: ev.outcome.patient_id,
      });
      persons.push({
        key: `p-${i}`,
        patientId: ev.outcome.patient_id,
        physicianId: ev.outcome.physician_id,
        region: fallback.region,
        city: fallback.city,
        diagnosis: ev.outcome.diagnosis,
        amount: ev.outcome.amount_usd,
        outcome: ev.outcome.outcome,
        roundId: ev.roundId,
      });
      toolLog.push({ key: `t-${i}`, roundId: ev.roundId, tool: ev.tool });
      continue;
    }
    if (ev.kind === "skip") {
      organicCount += 1;
      persons.push({
        key: `p-${i}`,
        patientId: ev.outcome.patient_id,
        physicianId: ev.outcome.physician_id,
        region: ev.outcome.physician_region,
        city: lookups.geoById.get(ev.outcome.physician_id)?.city ?? ev.outcome.physician_region,
        diagnosis: ev.outcome.diagnosis,
        amount: 0,
        outcome: ev.outcome.outcome,
        roundId: ev.roundId,
      });
    }
  }

  const byRegion = [...regionMap.values()].sort((a, b) => b.spend - a.spend);

  return {
    roundIndex,
    roundId,
    totalRounds,
    budgetTotal,
    spend,
    fundedCount,
    peopleReached: fundedCount,
    medicatedCount,
    organicCount,
    costPerMedicated: medicatedCount > 0 ? spend / medicatedCount : null,
    conversionRate: fundedCount > 0 ? medicatedCount / fundedCount : 0,
    byRegion,
    flows,
    persons: persons.slice().reverse(),
    toolLog: toolLog.slice().reverse(),
    latestKind,
    progress: events.length > 1 ? upTo / (events.length - 1) : 1,
  };
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export const SPEEDS = [0.5, 1, 2, 4] as const;
const BASE_STEP_MS = 1100;

export interface ReplayController {
  state: ReplayState;
  index: number;
  total: number;
  playing: boolean;
  speed: number;
  finished: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (i: number) => void;
  setSpeed: (s: number) => void;
  restart: () => void;
}

export function useReplay(dashboard: DashboardPayload): ReplayController {
  const events = useMemo(() => buildTimeline(dashboard), [dashboard]);
  const lookups = useMemo(() => buildLookups(dashboard), [dashboard]);
  const totalRounds = dashboard.playback.length;
  const total = events.length;

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finished = index >= total - 1;

  useEffect(() => {
    if (!playing || finished) return;
    timer.current = setTimeout(() => {
      setIndex((i) => Math.min(i + 1, total - 1));
    }, BASE_STEP_MS / speed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, finished, index, speed, total]);

  // Auto-pause on reaching the end.
  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);

  const play = useCallback(() => {
    setPlaying((p) => {
      // Restart from the top if replaying after completion.
      if (!p) setIndex((i) => (i >= total - 1 ? 0 : i));
      return true;
    });
  }, [total]);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => (playing ? pause() : play()), [playing, play, pause]);
  const seek = useCallback(
    (i: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(i, total - 1)));
    },
    [total],
  );
  const restart = useCallback(() => {
    setIndex(0);
    setPlaying(true);
  }, []);

  const state = useMemo(
    () => computeState(events, index, lookups, totalRounds),
    [events, index, lookups, totalRounds],
  );

  return {
    state,
    index,
    total,
    playing,
    speed,
    finished,
    play,
    pause,
    toggle,
    seek,
    setSpeed,
    restart,
  };
}
