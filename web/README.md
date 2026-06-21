# Sponsorship HUD — Web

Animated, live control room for the RL agent allocating sponsorship dollars across
the US. Built with Next.js (App Router) + TypeScript, Tailwind, framer-motion,
react-simple-maps (`geoAlbersUsa`), and Recharts.

## What it shows

- A **US map** with the agent/treasury node in the center and a node per physician
  **zip code**. Animated arc **flow lines** stream money from the agent to each zip;
  arc width and node size scale with dollars, color encodes outcome
  (emerald = medicated, slate = funded but no conversion, amber = organic).
- **Money + people by region** (live bar list) and **by person** (streaming feed),
  plus the agent's **HUD tool calls**, a **cost-per-medicated** comparison
  (trained vs greedy vs random) and the **training curve**.
- A **replay engine** that steps through the production playback rounds with
  play/pause/scrub/speed — every allocation animates as it happens.

## Run

The UI reads the FastAPI read-layer (`../app/main.py`). Start both:

```bash
# 1) API (repo root)
uvicorn app.main:app --reload --port 8000

# 2) Web (this dir)
npm install
npm run dev          # http://localhost:3000
```

Point the UI at a different API host with `NEXT_PUBLIC_API_BASE` (see `.env.example`).

## Geography (zipcode-driven)

Physicians carry a `zip`; the API (`app/geo.py`) resolves it to `lat/lon/city` via a
**ZIP3-prefix centroid table** (`data/geo/zip3_centroids.json`). That means real
zipcodes can drop into the data later and plot correctly with **no code change** —
only the centroid table grows. Today's fixtures seed plausible ZIPs per region.
