import unittest

from fastapi.testclient import TestClient

from app.main import app


class DashboardApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_health(self) -> None:
        response = self.client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_dashboard_payload_contains_core_sections(self) -> None:
        response = self.client.get("/api/dashboard")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            sorted(payload.keys()),
            [
                "dose_response",
                "eval_summaries",
                "overview",
                "patients",
                "physicians",
                "playback",
                "rounds",
                "sensitivity",
                "task_results",
                "training_curve",
            ],
        )
        self.assertEqual(payload["overview"]["total_patients"], 12)
        self.assertEqual(payload["overview"]["medicated"], 8)
        self.assertEqual(payload["overview"]["undermedicated"], 4)
        self.assertGreater(payload["overview"]["avg_treatment_gap_days"], 0)
        self.assertGreater(len(payload["overview"]["allocation_by_region"]), 0)

    def test_playback_rounds_show_shrinking_pool(self) -> None:
        response = self.client.get("/api/playback")

        self.assertEqual(response.status_code, 200)
        rounds = response.json()
        self.assertGreater(len(rounds), 0)
        starting_pool = rounds[0]["started_pool"]
        ending_pools = [round_item["ending_pool"] for round_item in rounds]
        self.assertEqual(starting_pool, 12)
        self.assertEqual(ending_pools, sorted(ending_pools, reverse=True))
        self.assertEqual(rounds[-1]["running_medicated"], 8)
        self.assertIn("budget", rounds[0])
        self.assertGreater(len(rounds[0]["tool_events"]), 0)

    def test_reward_accounting_marks_only_funded_rows_counted(self) -> None:
        response = self.client.get("/api/playback")

        self.assertEqual(response.status_code, 200)
        first_round = response.json()[0]
        self.assertTrue(all(row["counted_in_reward"] for row in first_round["funded"]))
        self.assertTrue(all(not row["counted_in_reward"] for row in first_round["skipped"]))
        organic_rows = [
            row
            for round_item in response.json()
            for row in round_item["skipped"]
            if row["outcome"] == "organic_medicated"
        ]
        self.assertGreaterEqual(len(organic_rows), 1)

    def test_eval_summaries_include_trained_policy(self) -> None:
        response = self.client.get("/api/eval")

        self.assertEqual(response.status_code, 200)
        policies = {row["policy_name"]: row for row in response.json()}
        self.assertIn("trained", policies)
        self.assertLess(
            policies["trained"]["avg_cost_per_medicated"],
            policies["random"]["avg_cost_per_medicated"],
        )
        self.assertGreater(policies["trained"]["spend_efficiency_index"], 0)

    def test_physicians_carry_resolved_geo(self) -> None:
        response = self.client.get("/api/physicians")

        self.assertEqual(response.status_code, 200)
        physicians = response.json()
        self.assertGreater(len(physicians), 0)
        for physician in physicians:
            self.assertIn("zip", physician)
            self.assertIsInstance(physician["lat"], float)
            self.assertIsInstance(physician["lon"], float)
            # Contiguous-US sanity bounds (incl. resolved zip3 centroids).
            self.assertTrue(24.0 <= physician["lat"] <= 50.0)
            self.assertTrue(-125.0 <= physician["lon"] <= -66.0)
            self.assertTrue(physician["city"])

    def test_geo_endpoint_returns_one_point_per_physician(self) -> None:
        physicians = self.client.get("/api/physicians").json()
        geo_points = self.client.get("/api/geo").json()

        self.assertEqual(len(geo_points), len(physicians))
        self.assertEqual(
            {point["physician_id"] for point in geo_points},
            {physician["physician_id"] for physician in physicians},
        )

    def test_dashboard_top_level_keys_unchanged(self) -> None:
        # Geo enrichment must stay additive: no new top-level dashboard keys.
        payload = self.client.get("/api/dashboard").json()
        self.assertEqual(
            sorted(payload.keys()),
            [
                "dose_response",
                "eval_summaries",
                "overview",
                "patients",
                "physicians",
                "playback",
                "rounds",
                "sensitivity",
                "task_results",
                "training_curve",
            ],
        )

    def test_training_and_response_exports_exist(self) -> None:
        response = self.client.get("/api/dashboard")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreaterEqual(len(payload["training_curve"]), 5)
        self.assertGreaterEqual(len(payload["dose_response"]), 10)
        self.assertGreaterEqual(len(payload["task_results"]), 3)
        self.assertGreaterEqual(len(payload["sensitivity"]), 4)


if __name__ == "__main__":
    unittest.main()
