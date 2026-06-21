from __future__ import annotations

import json
import os
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import geo


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "data" / "fixtures"
STATIC_DIR = ROOT / "static"


class PatientView(BaseModel):
    patient_id: str
    physician_id: str
    age: int
    diagnosis: str
    diagnosis_to_treatment_gap_days: int
    status: Literal["undermedicated", "medicated"]
    last_round_funded_usd: float | None
    updated_at: str


class PhysicianView(BaseModel):
    physician_id: str
    specialty: str
    region: str
    panel_size: int
    dossier_summary: str
    saturation_band: Literal["fresh", "warming", "near_saturation"]
    cumulative_sponsorship_usd: float
    # Zipcode-driven geo. ``zip`` is the (future) source of truth; lat/lon/city are
    # resolved server-side so the frontend can plot allocations on the US map.
    zip: str | None = None
    lat: float | None = None
    lon: float | None = None
    city: str | None = None


class GeoPointView(BaseModel):
    physician_id: str
    region: str
    zip: str | None
    lat: float
    lon: float
    city: str


class RoundResult(BaseModel):
    round_id: str
    total_spend: float
    num_funded: int
    num_medicated_among_funded: int
    cost_per_medicated: float | None
    reward: float


class EvalSummary(BaseModel):
    policy_name: Literal["random", "greedy", "trained"]
    avg_cost_per_medicated: float
    rounds_evaluated: int
    conversion_rate: float
    spend_efficiency_index: float


class BudgetStatus(BaseModel):
    budget_total_usd: float
    budget_remaining_usd: float
    patients_reviewed: int
    patients_total: int


class ToolEvent(BaseModel):
    tool_name: Literal[
        "get_active_patients",
        "get_budget_status",
        "allocate_funding",
        "end_round",
        "resolve_round",
    ]
    status: Literal["read", "queued", "resolved"]
    detail: str
    amount_usd: float | None = None
    patient_id: str | None = None


class FundingOutcome(BaseModel):
    patient_id: str
    physician_id: str
    age: int
    diagnosis: str
    diagnosis_to_treatment_gap_days: int
    physician_specialty: str
    physician_region: str
    amount_usd: float
    projected_conversion_rate: float
    expected_lift_pp: float
    counted_in_reward: bool
    outcome: Literal["medicated", "undermedicated", "organic_medicated"]


class PlaybackRound(BaseModel):
    round_id: str
    started_pool: int
    ending_pool: int
    budget: BudgetStatus
    running_spend: float
    running_medicated: int
    running_cost_per_medicated: float | None
    summary: RoundResult
    funded: list[FundingOutcome]
    skipped: list[FundingOutcome]
    tool_events: list[ToolEvent]


class TrainingPoint(BaseModel):
    step: int
    trained_cost_per_medicated: float
    random_cost_per_medicated: float
    greedy_cost_per_medicated: float


class TaskResult(BaseModel):
    task_id: str
    difficulty: Literal["easy", "medium", "hard"]
    budget_total_usd: float
    population_seed: int
    avg_reward: float
    variance: float


class SensitivityResult(BaseModel):
    scenario: str
    trained_cost_per_medicated: float
    random_cost_per_medicated: float
    greedy_cost_per_medicated: float


class DoseResponsePoint(BaseModel):
    physician_id: str
    patient_id: str
    amount_usd: float
    probability: float


class AllocationBucket(BaseModel):
    label: str
    spend_usd: float
    medicated: int
    funded: int


class SpecialtyBucket(BaseModel):
    label: str
    undermedicated: int
    medicated: int


class RegionBucket(BaseModel):
    label: str
    patient_count: int
    cumulative_sponsorship_usd: float


class Overview(BaseModel):
    total_patients: int
    undermedicated: int
    medicated: int
    total_sponsorship_usd: float
    avg_cost_per_medicated: float | None
    avg_treatment_gap_days: float
    specialty_buckets: list[SpecialtyBucket]
    region_buckets: list[RegionBucket]
    allocation_by_region: list[AllocationBucket]


class DashboardPayload(BaseModel):
    overview: Overview
    patients: list[PatientView]
    physicians: list[PhysicianView]
    rounds: list[RoundResult]
    eval_summaries: list[EvalSummary]
    playback: list[PlaybackRound]
    training_curve: list[TrainingPoint]
    task_results: list[TaskResult]
    sensitivity: list[SensitivityResult]
    dose_response: list[DoseResponsePoint]


class DataRepository:
    def __init__(self) -> None:
        self.fixture_dir = FIXTURE_DIR

    def _json_path(self, env_name: str, fixture_name: str) -> Path:
        return Path(os.environ.get(env_name, self.fixture_dir / fixture_name))

    def _load_json(self, env_name: str, fixture_name: str) -> list[dict]:
        path = self._json_path(env_name, fixture_name)
        if not path.exists():
            raise HTTPException(status_code=503, detail=f"Data source missing: {path}")
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if not isinstance(payload, list):
            raise HTTPException(status_code=503, detail=f"Expected list in {path}")
        return payload

    def patients(self) -> list[PatientView]:
        sqlite_path = os.environ.get("CASEY_SQLITE_PATH")
        if sqlite_path:
            return self._patients_from_sqlite(Path(sqlite_path))
        return [
            PatientView.model_validate(row)
            for row in self._load_json("PATIENTS_JSON", "patients.json")
        ]

    def physicians(self) -> list[PhysicianView]:
        sqlite_path = os.environ.get("CASEY_SQLITE_PATH")
        if sqlite_path:
            rows = self._physicians_from_sqlite(Path(sqlite_path))
        else:
            rows = [
                PhysicianView.model_validate(row)
                for row in self._load_json("PHYSICIANS_JSON", "physicians.json")
            ]
        return [self._attach_geo(physician) for physician in rows]

    @staticmethod
    def _attach_geo(physician: PhysicianView) -> PhysicianView:
        point = geo.resolve(physician.zip, physician.region)
        return physician.model_copy(
            update={"lat": point.lat, "lon": point.lon, "city": point.city}
        )

    def geo_points(self) -> list[GeoPointView]:
        return [
            GeoPointView(
                physician_id=physician.physician_id,
                region=physician.region,
                zip=physician.zip,
                lat=physician.lat if physician.lat is not None else 0.0,
                lon=physician.lon if physician.lon is not None else 0.0,
                city=physician.city or "Unknown",
            )
            for physician in self.physicians()
        ]

    def rounds(self) -> list[RoundResult]:
        return [
            RoundResult.model_validate(row)
            for row in self._load_json("ROUNDS_JSON", "rounds.json")
        ]

    def eval_summaries(self) -> list[EvalSummary]:
        return [
            EvalSummary.model_validate(row)
            for row in self._load_json("EVAL_SUMMARIES_JSON", "eval_summaries.json")
        ]

    def playback(self) -> list[PlaybackRound]:
        return [
            PlaybackRound.model_validate(row)
            for row in self._load_json("PLAYBACK_JSON", "playback.json")
        ]

    def training_curve(self) -> list[TrainingPoint]:
        return [
            TrainingPoint.model_validate(row)
            for row in self._load_json("TRAINING_CURVE_JSON", "training_curve.json")
        ]

    def task_results(self) -> list[TaskResult]:
        return [
            TaskResult.model_validate(row)
            for row in self._load_json("TASK_RESULTS_JSON", "task_results.json")
        ]

    def sensitivity(self) -> list[SensitivityResult]:
        return [
            SensitivityResult.model_validate(row)
            for row in self._load_json("SENSITIVITY_JSON", "sensitivity.json")
        ]

    def dose_response(self) -> list[DoseResponsePoint]:
        return [
            DoseResponsePoint.model_validate(row)
            for row in self._load_json("DOSE_RESPONSE_JSON", "dose_response.json")
        ]

    def overview(self) -> Overview:
        patients = self.patients()
        physicians = self.physicians()
        rounds = self.rounds()
        physician_by_id = {item.physician_id: item for item in physicians}

        specialty_counts: dict[str, dict[str, int]] = {}
        for patient in patients:
            physician = physician_by_id.get(patient.physician_id)
            label = physician.specialty if physician else "Unknown"
            bucket = specialty_counts.setdefault(label, {"undermedicated": 0, "medicated": 0})
            bucket[patient.status] += 1

        region_counts: dict[str, RegionBucket] = {}
        for physician in physicians:
            bucket = region_counts.setdefault(
                physician.region,
                RegionBucket(
                    label=physician.region,
                    patient_count=0,
                    cumulative_sponsorship_usd=0,
                ),
            )
            bucket.cumulative_sponsorship_usd += physician.cumulative_sponsorship_usd

        for patient in patients:
            physician = physician_by_id.get(patient.physician_id)
            if physician and physician.region in region_counts:
                region_counts[physician.region].patient_count += 1

        cost_values = [
            round_result.cost_per_medicated
            for round_result in rounds
            if round_result.cost_per_medicated is not None
        ]
        allocation_by_region: dict[str, AllocationBucket] = {}
        for round_result in self.playback():
            for allocation in round_result.funded:
                bucket = allocation_by_region.setdefault(
                    allocation.physician_region,
                    AllocationBucket(
                        label=allocation.physician_region,
                        spend_usd=0,
                        medicated=0,
                        funded=0,
                    ),
                )
                bucket.spend_usd += allocation.amount_usd
                bucket.funded += 1
                if allocation.outcome == "medicated":
                    bucket.medicated += 1

        return Overview(
            total_patients=len(patients),
            undermedicated=sum(1 for patient in patients if patient.status == "undermedicated"),
            medicated=sum(1 for patient in patients if patient.status == "medicated"),
            total_sponsorship_usd=sum(
                physician.cumulative_sponsorship_usd for physician in physicians
            ),
            avg_cost_per_medicated=(
                sum(cost_values) / len(cost_values) if cost_values else None
            ),
            avg_treatment_gap_days=(
                sum(patient.diagnosis_to_treatment_gap_days for patient in patients) / len(patients)
                if patients
                else 0
            ),
            specialty_buckets=[
                SpecialtyBucket(label=label, **counts)
                for label, counts in sorted(specialty_counts.items())
            ],
            region_buckets=sorted(region_counts.values(), key=lambda item: item.label),
            allocation_by_region=sorted(
                allocation_by_region.values(),
                key=lambda item: item.spend_usd,
                reverse=True,
            ),
        )

    def dashboard(self) -> DashboardPayload:
        return DashboardPayload(
            overview=self.overview(),
            patients=self.patients(),
            physicians=self.physicians(),
            rounds=self.rounds(),
            eval_summaries=self.eval_summaries(),
            playback=self.playback(),
            training_curve=self.training_curve(),
            task_results=self.task_results(),
            sensitivity=self.sensitivity(),
            dose_response=self.dose_response(),
        )

    def _connect_readonly(self, path: Path) -> sqlite3.Connection:
        if not path.exists():
            raise HTTPException(status_code=503, detail=f"SQLite source missing: {path}")
        uri = f"file:{path}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    def _patients_from_sqlite(self, path: Path) -> list[PatientView]:
        with self._connect_readonly(path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT patient_id, physician_id, diagnosis, status,
                       age, diagnosis_to_treatment_gap_days,
                       last_round_funded_usd, updated_at
                FROM patient_views
                ORDER BY updated_at DESC, patient_id ASC
                """
            ).fetchall()
        return [PatientView.model_validate(dict(row)) for row in rows]

    def _physicians_from_sqlite(self, path: Path) -> list[PhysicianView]:
        with self._connect_readonly(path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT physician_id, specialty, region, panel_size, dossier_summary,
                       saturation_band, cumulative_sponsorship_usd
                FROM physician_views
                ORDER BY cumulative_sponsorship_usd DESC, physician_id ASC
                """
            ).fetchall()
        return [PhysicianView.model_validate(dict(row)) for row in rows]


@lru_cache
def repository() -> DataRepository:
    return DataRepository()


app = FastAPI(
    title="Agent Sponsorship HUD",
    summary="Read-only API and demo dashboard for production-mode agent playback.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/patients", response_model=list[PatientView])
def get_patients() -> list[PatientView]:
    return repository().patients()


@app.get("/api/physicians", response_model=list[PhysicianView])
def get_physicians() -> list[PhysicianView]:
    return repository().physicians()


@app.get("/api/geo", response_model=list[GeoPointView])
def get_geo() -> list[GeoPointView]:
    return repository().geo_points()


@app.get("/api/rounds", response_model=list[RoundResult])
def get_rounds() -> list[RoundResult]:
    return repository().rounds()


@app.get("/api/eval", response_model=list[EvalSummary])
def get_eval_summaries() -> list[EvalSummary]:
    return repository().eval_summaries()


@app.get("/api/playback", response_model=list[PlaybackRound])
def get_playback() -> list[PlaybackRound]:
    return repository().playback()


@app.get("/api/overview", response_model=Overview)
def get_overview() -> Overview:
    return repository().overview()


@app.get("/api/dashboard", response_model=DashboardPayload)
def get_dashboard() -> DashboardPayload:
    return repository().dashboard()


@app.get("/api/model-allocation")
def get_model_allocation() -> dict:
    """The trained model's provider ranking + money allocation (from its real
    submit_ranking output), shaped for the US map: `baseRegions` (geo) +
    `byRegion` (spend/converted per region) + the ordered `ranking`."""
    path = FIXTURE_DIR / "model_allocation.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="model_allocation fixture not found")
    return json.loads(path.read_text())


if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
