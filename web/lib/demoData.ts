// ---------------------------------------------------------------------------
// Synthetic large-scale demo dataset.
//
// The live agent only emits a tiny placeholder cohort today, so this generates
// a deterministic, full-scale DashboardPayload — ~150 physicians across ~90 US
// metros, a dozen funding rounds — purely to *showcase* what the agent's output
// looks like at scale. It conforms exactly to lib/types.ts; nothing about the
// data contract, backend, or replay engine changes.
// ---------------------------------------------------------------------------
import type {
  DashboardPayload,
  EvalSummary,
  FundingOutcome,
  PatientView,
  PhysicianView,
  PlaybackRound,
  RoundResult,
  ToolEvent,
  TrainingPoint,
} from "./types";

// Deterministic PRNG so the demo looks identical on every load.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [city, state, lat, lon] — a spread of US metros so the map fills coast-to-coast.
const CITIES: [string, string, number, number][] = [
  ["New York", "NY", 40.71, -74.01], ["Los Angeles", "CA", 34.05, -118.24],
  ["Chicago", "IL", 41.88, -87.63], ["Houston", "TX", 29.76, -95.37],
  ["Phoenix", "AZ", 33.45, -112.07], ["Philadelphia", "PA", 39.95, -75.17],
  ["San Antonio", "TX", 29.42, -98.49], ["San Diego", "CA", 32.72, -117.16],
  ["Dallas", "TX", 32.78, -96.8], ["San Jose", "CA", 37.34, -121.89],
  ["Austin", "TX", 30.27, -97.74], ["Jacksonville", "FL", 30.33, -81.66],
  ["Fort Worth", "TX", 32.76, -97.33], ["Columbus", "OH", 39.96, -83.0],
  ["Charlotte", "NC", 35.23, -80.84], ["San Francisco", "CA", 37.77, -122.42],
  ["Indianapolis", "IN", 39.77, -86.16], ["Seattle", "WA", 47.61, -122.33],
  ["Denver", "CO", 39.74, -104.99], ["Washington", "DC", 38.91, -77.04],
  ["Boston", "MA", 42.36, -71.06], ["El Paso", "TX", 31.76, -106.49],
  ["Nashville", "TN", 36.16, -86.78], ["Detroit", "MI", 42.33, -83.05],
  ["Oklahoma City", "OK", 35.47, -97.52], ["Portland", "OR", 45.52, -122.68],
  ["Las Vegas", "NV", 36.17, -115.14], ["Memphis", "TN", 35.15, -90.05],
  ["Louisville", "KY", 38.25, -85.76], ["Baltimore", "MD", 39.29, -76.61],
  ["Milwaukee", "WI", 43.04, -87.91], ["Albuquerque", "NM", 35.08, -106.65],
  ["Tucson", "AZ", 32.22, -110.97], ["Fresno", "CA", 36.74, -119.79],
  ["Sacramento", "CA", 38.58, -121.49], ["Kansas City", "MO", 39.1, -94.58],
  ["Mesa", "AZ", 33.42, -111.83], ["Atlanta", "GA", 33.75, -84.39],
  ["Omaha", "NE", 41.26, -95.93], ["Colorado Springs", "CO", 38.83, -104.82],
  ["Raleigh", "NC", 35.78, -78.64], ["Miami", "FL", 25.76, -80.19],
  ["Long Beach", "CA", 33.77, -118.19], ["Virginia Beach", "VA", 36.85, -75.98],
  ["Oakland", "CA", 37.8, -122.27], ["Minneapolis", "MN", 44.98, -93.27],
  ["Tampa", "FL", 27.95, -82.46], ["Tulsa", "OK", 36.15, -95.99],
  ["Arlington", "TX", 32.74, -97.11], ["New Orleans", "LA", 29.95, -90.07],
  ["Wichita", "KS", 37.69, -97.34], ["Cleveland", "OH", 41.5, -81.69],
  ["Bakersfield", "CA", 35.37, -119.02], ["Aurora", "CO", 39.73, -104.83],
  ["Anaheim", "CA", 33.84, -117.91], ["Honolulu", "HI", 21.31, -157.86],
  ["Santa Ana", "CA", 33.75, -117.87], ["Riverside", "CA", 33.95, -117.4],
  ["Corpus Christi", "TX", 27.8, -97.4], ["Lexington", "KY", 38.04, -84.5],
  ["Henderson", "NV", 36.04, -114.98], ["Stockton", "CA", 37.96, -121.29],
  ["St. Louis", "MO", 38.63, -90.2], ["Cincinnati", "OH", 39.1, -84.51],
  ["Pittsburgh", "PA", 40.44, -79.99], ["Greensboro", "NC", 36.07, -79.79],
  ["Anchorage", "AK", 61.22, -149.9], ["Plano", "TX", 33.02, -96.7],
  ["Orlando", "FL", 28.54, -81.38], ["Irvine", "CA", 33.68, -117.83],
  ["Newark", "NJ", 40.74, -74.17], ["Durham", "NC", 35.99, -78.9],
  ["Chula Vista", "CA", 32.64, -117.08], ["Toledo", "OH", 41.66, -83.56],
  ["Fort Wayne", "IN", 41.08, -85.14], ["St. Petersburg", "FL", 27.77, -82.64],
  ["Laredo", "TX", 27.53, -99.49], ["Jersey City", "NJ", 40.73, -74.08],
  ["Chandler", "AZ", 33.31, -111.84], ["Madison", "WI", 43.07, -89.4],
  ["Buffalo", "NY", 42.89, -78.88], ["Lubbock", "TX", 33.58, -101.86],
  ["Scottsdale", "AZ", 33.49, -111.92], ["Reno", "NV", 39.53, -119.81],
  ["Glendale", "AZ", 33.54, -112.19], ["Norfolk", "VA", 36.85, -76.29],
  ["Winston-Salem", "NC", 36.1, -80.24], ["Boise", "ID", 43.62, -116.21],
  ["Richmond", "VA", 37.54, -77.44], ["Des Moines", "IA", 41.59, -93.62],
  ["Spokane", "WA", 47.66, -117.43], ["Salt Lake City", "UT", 40.76, -111.89],
  ["Birmingham", "AL", 33.52, -86.81], ["Rochester", "NY", 43.16, -77.61],
];

const SPECIALTIES = [
  "Endocrinology", "Internal Medicine", "Family Medicine", "Cardiology",
  "Nephrology", "Primary Care", "Geriatrics",
];
const DIAGNOSES = [
  "Type 2 Diabetes", "Type 2 Diabetes", "Type 2 Diabetes", "Prediabetes",
  "T2D + Hypertension", "T2D + CKD",
];
const FIRST = ["J.", "M.", "A.", "R.", "S.", "L.", "K.", "D.", "P.", "C.", "T.", "E."];
const LAST = ["Doe", "Reyes", "Khan", "Nguyen", "Patel", "Brooks", "Cole", "Ramos", "Webb", "Frost", "Tran", "Okafor"];

const BAND = ["fresh", "warming", "near_saturation"] as const;

export function buildDemoDashboard(): DashboardPayload {
  const rng = mulberry32(20260621);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
  const rint = (lo: number, hi: number) => Math.floor(lo + rng() * (hi - lo + 1));

  // ---- Physicians: 1 per metro, plus a 2nd in the larger ones (~150 total) ----
  const physicians: PhysicianView[] = [];
  CITIES.forEach(([city, st, lat, lon], i) => {
    const count = i < 60 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const id = `DR-${String(physicians.length + 1).padStart(4, "0")}`;
      const jitter = k === 0 ? 0 : 0.18;
      physicians.push({
        physician_id: id,
        specialty: pick(SPECIALTIES),
        region: `${city}, ${st}`,
        panel_size: rint(28, 140),
        dossier_summary: `${city} panel · GLP-1 white-space`,
        saturation_band: pick(BAND),
        cumulative_sponsorship_usd: rint(2, 40) * 1000,
        zip: null,
        lat: lat + (k ? jitter : 0),
        lon: lon + (k ? jitter : 0),
        city: `${city}, ${st}`,
      });
    }
  });

  const totalSponsorship = physicians.reduce((s, p) => s + p.cumulative_sponsorship_usd, 0);

  // ---- Rounds of agent funding. The agent learns: conversion climbs, the
  // cost-per-medicated falls toward the trained eval as rounds progress. ----
  const ROUNDS = 12;
  const BUDGET = 240_000;
  const playback: PlaybackRound[] = [];
  const rounds: RoundResult[] = [];
  const patients: PatientView[] = [];

  let runningSpend = 0;
  let runningMedicated = 0;
  let patientSeq = 1000;

  for (let r = 0; r < ROUNDS; r++) {
    const roundId = `R${r + 1}`;
    const conv = 0.42 + (r / (ROUNDS - 1)) * 0.34; // 0.42 → 0.76
    const fundCount = rint(10, 16);

    const funded: FundingOutcome[] = [];
    const skipped: FundingOutcome[] = [];
    const toolEvents: ToolEvent[] = [];
    toolEvents.push({ tool_name: "get_active_patients", status: "read", detail: `Scan pool · round ${r + 1}`, amount_usd: null, patient_id: null });
    toolEvents.push({ tool_name: "get_budget_status", status: "read", detail: `Budget check`, amount_usd: null, patient_id: null });

    let roundSpend = 0;
    let roundMedicated = 0;

    for (let f = 0; f < fundCount; f++) {
      // Bias funding toward bigger panels (the agent's learned prior).
      let phys = pick(physicians);
      for (let t = 0; t < 3; t++) {
        const alt = pick(physicians);
        if (alt.panel_size > phys.panel_size) phys = alt;
      }
      const patientId = `PT-${patientSeq++}`;
      const amount = rint(120, 520);
      const projected = Math.min(0.92, conv + (rng() - 0.5) * 0.25);
      const isMed = rng() < projected;
      const gap = rint(35, 420);
      const age = rint(41, 79);
      const diagnosis = pick(DIAGNOSES);
      const outcome: FundingOutcome["outcome"] = isMed ? "medicated" : "undermedicated";

      const fo: FundingOutcome = {
        patient_id: patientId,
        physician_id: phys.physician_id,
        age,
        diagnosis,
        diagnosis_to_treatment_gap_days: gap,
        physician_specialty: phys.specialty,
        physician_region: phys.region,
        amount_usd: amount,
        projected_conversion_rate: projected,
        expected_lift_pp: Math.round(projected * 100) / 100,
        counted_in_reward: true,
        outcome,
      };
      funded.push(fo);
      toolEvents.push({
        tool_name: "allocate_funding",
        status: "queued",
        detail: `${FIRST[patientSeq % FIRST.length]} ${LAST[patientSeq % LAST.length]} · ${phys.region}`,
        amount_usd: amount,
        patient_id: patientId,
      });

      roundSpend += amount;
      if (isMed) roundMedicated += 1;

      patients.push({
        patient_id: patientId,
        physician_id: phys.physician_id,
        age,
        diagnosis,
        diagnosis_to_treatment_gap_days: gap,
        status: isMed ? "medicated" : "undermedicated",
        last_round_funded_usd: amount,
        updated_at: `2026-06-${String(7 + r).padStart(2, "0")}T12:00:00Z`,
      });
    }

    // A couple of organic conversions among the unfunded each round.
    for (let s = 0; s < rint(1, 3); s++) {
      const phys = pick(physicians);
      const patientId = `PT-${patientSeq++}`;
      skipped.push({
        patient_id: patientId,
        physician_id: phys.physician_id,
        age: rint(41, 79),
        diagnosis: pick(DIAGNOSES),
        diagnosis_to_treatment_gap_days: rint(35, 420),
        physician_specialty: phys.specialty,
        physician_region: phys.region,
        amount_usd: 0,
        projected_conversion_rate: 0,
        expected_lift_pp: 0,
        counted_in_reward: false,
        outcome: "organic_medicated",
      });
    }

    toolEvents.push({ tool_name: "resolve_round", status: "resolved", detail: `Resolve ${roundId}`, amount_usd: null, patient_id: null });

    runningSpend += roundSpend;
    runningMedicated += roundMedicated;
    const costPerMed = roundMedicated > 0 ? roundSpend / roundMedicated : null;

    const summary: RoundResult = {
      round_id: roundId,
      total_spend: roundSpend,
      num_funded: funded.length,
      num_medicated_among_funded: roundMedicated,
      cost_per_medicated: costPerMed,
      reward: Math.round(roundMedicated * 1000 - roundSpend),
    };
    rounds.push(summary);

    playback.push({
      round_id: roundId,
      started_pool: 1800 - r * 120,
      ending_pool: 1800 - (r + 1) * 120,
      budget: {
        budget_total_usd: BUDGET,
        budget_remaining_usd: BUDGET - runningSpend,
        patients_reviewed: (r + 1) * 150,
        patients_total: 1800,
      },
      running_spend: runningSpend,
      running_medicated: runningMedicated,
      running_cost_per_medicated: runningMedicated > 0 ? runningSpend / runningMedicated : null,
      summary,
      funded,
      skipped,
      tool_events: toolEvents,
    });
  }

  // ---- Eval summaries: trained beats greedy beats random. ----
  const eval_summaries: EvalSummary[] = [
    { policy_name: "random", avg_cost_per_medicated: 910, rounds_evaluated: 40, conversion_rate: 0.27, spend_efficiency_index: 0.41 },
    { policy_name: "greedy", avg_cost_per_medicated: 640, rounds_evaluated: 40, conversion_rate: 0.43, spend_efficiency_index: 0.63 },
    { policy_name: "trained", avg_cost_per_medicated: 438, rounds_evaluated: 40, conversion_rate: 0.64, spend_efficiency_index: 0.88 },
  ];

  // ---- Training curve: trained dives, ghosts stay flat-ish. ----
  const training_curve: TrainingPoint[] = Array.from({ length: 26 }, (_, s) => {
    const t = s / 25;
    return {
      step: s * 20,
      trained_cost_per_medicated: Math.round(1500 - (1500 - 438) * (1 - Math.pow(1 - t, 2)) + (rng() - 0.5) * 40),
      greedy_cost_per_medicated: Math.round(640 + (rng() - 0.5) * 30),
      random_cost_per_medicated: Math.round(910 + (rng() - 0.5) * 60),
    };
  });

  // ---- Overview rollups. ----
  const regionMap = new Map<string, { patient_count: number; cumulative_sponsorship_usd: number }>();
  for (const p of physicians) {
    const b = regionMap.get(p.region) ?? { patient_count: 0, cumulative_sponsorship_usd: 0 };
    b.patient_count += p.panel_size;
    b.cumulative_sponsorship_usd += p.cumulative_sponsorship_usd;
    regionMap.set(p.region, b);
  }
  const specialtyMap = new Map<string, { undermedicated: number; medicated: number }>();
  for (const pt of patients) {
    const phys = physicians.find((p) => p.physician_id === pt.physician_id);
    const key = phys?.specialty ?? "Unknown";
    const b = specialtyMap.get(key) ?? { undermedicated: 0, medicated: 0 };
    if (pt.status === "medicated") b.medicated += 1;
    else b.undermedicated += 1;
    specialtyMap.set(key, b);
  }
  const allocMap = new Map<string, { spend_usd: number; medicated: number; funded: number }>();
  for (const round of playback) {
    for (const a of round.funded) {
      const b = allocMap.get(a.physician_region) ?? { spend_usd: 0, medicated: 0, funded: 0 };
      b.spend_usd += a.amount_usd;
      b.funded += 1;
      if (a.outcome === "medicated") b.medicated += 1;
      allocMap.set(a.physician_region, b);
    }
  }

  const undermedicated = patients.filter((p) => p.status === "undermedicated").length;
  const totalPanel = physicians.reduce((s, p) => s + p.panel_size, 0);

  return {
    overview: {
      total_patients: totalPanel,
      undermedicated: Math.round(totalPanel * 0.38),
      medicated: totalPanel - Math.round(totalPanel * 0.38),
      total_sponsorship_usd: totalSponsorship,
      avg_cost_per_medicated: 438,
      avg_treatment_gap_days: 168,
      specialty_buckets: [...specialtyMap.entries()].map(([label, v]) => ({ label, ...v })),
      region_buckets: [...regionMap.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => a.label.localeCompare(b.label)),
      allocation_by_region: [...allocMap.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.spend_usd - a.spend_usd),
    },
    patients,
    physicians,
    rounds,
    eval_summaries,
    playback,
    training_curve,
    task_results: [
      { task_id: "easy-0", difficulty: "easy", budget_total_usd: BUDGET, population_seed: 1, avg_reward: 14200, variance: 1200 },
      { task_id: "medium-0", difficulty: "medium", budget_total_usd: BUDGET, population_seed: 2, avg_reward: 11800, variance: 2600 },
      { task_id: "hard-0", difficulty: "hard", budget_total_usd: BUDGET, population_seed: 3, avg_reward: 9400, variance: 4100 },
    ],
    sensitivity: [
      { scenario: "Tight budget", trained_cost_per_medicated: 470, random_cost_per_medicated: 980, greedy_cost_per_medicated: 700 },
      { scenario: "Sparse panels", trained_cost_per_medicated: 510, random_cost_per_medicated: 1020, greedy_cost_per_medicated: 720 },
    ],
    dose_response: [],
  };
}
