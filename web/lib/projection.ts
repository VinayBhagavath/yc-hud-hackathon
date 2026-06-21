import { geoAlbersUsa, type GeoProjection } from "d3-geo";

// us-atlas states topojson is authored for a 975x610 frame with these params.
export const MAP_WIDTH = 975;
export const MAP_HEIGHT = 610;

// One shared projection instance so the choropleth, the physician nodes and the
// animated flow lines all land on the exact same pixel coordinates.
export const projection: GeoProjection = geoAlbersUsa()
  .scale(1300)
  .translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);

export interface XY {
  x: number;
  y: number;
}

export function project(lon: number, lat: number): XY | null {
  const point = projection([lon, lat]);
  if (!point) return null;
  return { x: point[0], y: point[1] };
}

// The agent / treasury node — money flows out from here. Placed over the lower
// midwest so arcs fan out to both coasts cleanly.
export const TREASURY: XY = { x: MAP_WIDTH * 0.5, y: MAP_HEIGHT * 0.62 };

// Quadratic bezier from treasury to a destination, bowed upward for a clean arc.
export function arcPath(from: XY, to: XY): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  // Perpendicular offset scales with distance for a graceful, consistent bow.
  const lift = Math.min(0.32 * dist, 150);
  const nx = -dy / dist;
  const ny = dx / dist;
  const cx = mx + nx * lift;
  const cy = my + ny * lift - 18;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}
