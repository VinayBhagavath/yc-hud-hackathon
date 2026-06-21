// Mirrors the FastAPI read-layer contract in app/main.py.

export type Outcome = "medicated" | "undermedicated" | "organic_medicated";
export type SaturationBand = "fresh" | "warming" | "near_saturation";
export type PolicyName = "random" | "greedy" | "trained";

export interface PhysicianView {
  physician_id: string;
  specialty: string;
  region: string;
  panel_size: number;
  dossier_summary: string;
  saturation_band: SaturationBand;
  cumulative_sponsorship_usd: number;
  zip: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
}

export interface PatientView {
  patient_id: string;
  physician_id: string;
  age: number;
  diagnosis: string;
  diagnosis_to_treatment_gap_days: number;
  status: "undermedicated" | "medicated";
  last_round_funded_usd: number | null;
  updated_at: string;
}

export interface ToolEvent {
  tool_name:
    | "get_active_patients"
    | "get_budget_status"
    | "allocate_funding"
    | "end_round"
    | "resolve_round";
  status: "read" | "queued" | "resolved";
  detail: string;
  amount_usd: number | null;
  patient_id: string | null;
}

export interface FundingOutcome {
  patient_id: string;
  physician_id: string;
  age: number;
  diagnosis: string;
  diagnosis_to_treatment_gap_days: number;
  physician_specialty: string;
  physician_region: string;
  amount_usd: number;
  projected_conversion_rate: number;
  expected_lift_pp: number;
  counted_in_reward: boolean;
  outcome: Outcome;
}

export interface BudgetStatus {
  budget_total_usd: number;
  budget_remaining_usd: number;
  patients_reviewed: number;
  patients_total: number;
}

export interface RoundResult {
  round_id: string;
  total_spend: number;
  num_funded: number;
  num_medicated_among_funded: number;
  cost_per_medicated: number | null;
  reward: number;
}

export interface PlaybackRound {
  round_id: string;
  started_pool: number;
  ending_pool: number;
  budget: BudgetStatus;
  running_spend: number;
  running_medicated: number;
  running_cost_per_medicated: number | null;
  summary: RoundResult;
  funded: FundingOutcome[];
  skipped: FundingOutcome[];
  tool_events: ToolEvent[];
}

export interface EvalSummary {
  policy_name: PolicyName;
  avg_cost_per_medicated: number;
  rounds_evaluated: number;
  conversion_rate: number;
  spend_efficiency_index: number;
}

export interface TrainingPoint {
  step: number;
  trained_cost_per_medicated: number;
  random_cost_per_medicated: number;
  greedy_cost_per_medicated: number;
}

export interface AllocationBucket {
  label: string;
  spend_usd: number;
  medicated: number;
  funded: number;
}

export interface RegionBucket {
  label: string;
  patient_count: number;
  cumulative_sponsorship_usd: number;
}

export interface SpecialtyBucket {
  label: string;
  undermedicated: number;
  medicated: number;
}

export interface Overview {
  total_patients: number;
  undermedicated: number;
  medicated: number;
  total_sponsorship_usd: number;
  avg_cost_per_medicated: number | null;
  avg_treatment_gap_days: number;
  specialty_buckets: SpecialtyBucket[];
  region_buckets: RegionBucket[];
  allocation_by_region: AllocationBucket[];
}

export interface TaskResult {
  task_id: string;
  difficulty: "easy" | "medium" | "hard";
  budget_total_usd: number;
  population_seed: number;
  avg_reward: number;
  variance: number;
}

export interface SensitivityResult {
  scenario: string;
  trained_cost_per_medicated: number;
  random_cost_per_medicated: number;
  greedy_cost_per_medicated: number;
}

export interface DoseResponsePoint {
  physician_id: string;
  patient_id: string;
  amount_usd: number;
  probability: number;
}

export interface DashboardPayload {
  overview: Overview;
  patients: PatientView[];
  physicians: PhysicianView[];
  rounds: RoundResult[];
  eval_summaries: EvalSummary[];
  playback: PlaybackRound[];
  training_curve: TrainingPoint[];
  task_results: TaskResult[];
  sensitivity: SensitivityResult[];
  dose_response: DoseResponsePoint[];
}
