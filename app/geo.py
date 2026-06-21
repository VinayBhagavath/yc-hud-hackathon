"""Zipcode-driven geo resolution for the Sponsorship HUD.

The agent allocates money to physicians; physicians live at a ZIP code. Today the
fixtures seed plausible ZIPs, but the data is designed to carry real zipcodes later
(``data has zipcode location data``). This module turns a ZIP (plus a region fallback)
into map coordinates so the frontend can plot allocation flows.

Resolution order, most specific first:

1. exact ZIP3 prefix (first 3 digits) -> ``zip3_centroids.json``
2. named region -> ``region_centroids.json``
3. geographic center of the contiguous US

A ZIP3-prefix table is the key design choice: ~900 prefixes cover every US 5-digit
zip approximately, so dropping in real zipcodes later ``just works`` without code
changes -- only the data table grows.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

ROOT = Path(__file__).resolve().parents[1]
GEO_DIR = ROOT / "data" / "geo"

# Geographic center of the contiguous United States (Lebanon, KS).
US_CENTER: tuple[float, float, str] = (39.8283, -98.5795, "United States")


class GeoPoint(NamedTuple):
    lat: float
    lon: float
    city: str
    # source describes how the point was resolved: "zip3", "region", or "fallback".
    source: str


def _load_table(name: str) -> dict[str, list]:
    path = GEO_DIR / name
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    # Tables carry a leading "_comment" key for documentation; ignore non-list values.
    return {key: value for key, value in payload.items() if isinstance(value, list)}


@lru_cache(maxsize=1)
def _zip3_table() -> dict[str, list]:
    return _load_table("zip3_centroids.json")


@lru_cache(maxsize=1)
def _region_table() -> dict[str, list]:
    return _load_table("region_centroids.json")


def _normalize_zip(zip_code: str | None) -> str | None:
    if not zip_code:
        return None
    digits = "".join(ch for ch in str(zip_code) if ch.isdigit())
    return digits[:5] if len(digits) >= 3 else None


def resolve(zip_code: str | None, region: str | None = None) -> GeoPoint:
    """Resolve a ZIP (with optional region fallback) to a map point."""
    normalized = _normalize_zip(zip_code)
    if normalized:
        entry = _zip3_table().get(normalized[:3])
        if entry:
            lat, lon, city = entry[0], entry[1], entry[2]
            return GeoPoint(float(lat), float(lon), str(city), "zip3")

    if region:
        entry = _region_table().get(region)
        if entry:
            lat, lon, city = entry[0], entry[1], entry[2]
            return GeoPoint(float(lat), float(lon), str(city), "region")

    lat, lon, city = US_CENTER
    return GeoPoint(lat, lon, city, "fallback")
