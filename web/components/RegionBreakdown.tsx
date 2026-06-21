"use client";

import { motion } from "framer-motion";
import type { ReplayState } from "@/lib/replay";
import { usd } from "@/lib/format";
import Placard from "./Placard";

export default function RegionBreakdown({ state }: { state: ReplayState }) {
  const rows = state.byRegion;
  const max = Math.max(1, ...rows.map((r) => r.spend));
  const activeRegion =
    state.flows.length > 0 ? state.flows[state.flows.length - 1].region : null;

  return (
    <section className="panel flex min-h-0 flex-1 flex-col p-4">
      <Placard
        title="Allocation by metro"
        subtitle="Top metros by dollars routed · emerald = converting"
        right={rows.length > 0 ? <span className="text-[11px] text-faint">{rows.length} active</span> : undefined}
      />
      <div className="scroll-thin -mr-2 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-2">
        {rows.length === 0 && (
          <p className="py-6 text-center text-xs text-faint">
            Waiting for the agent to allocate…
          </p>
        )}
        {rows.map((r) => {
          const isActive = r.region === activeRegion;
          return (
            <div key={r.region} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between text-xs">
                <span className="flex items-center gap-1.5 font-medium text-ink">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      r.medicated > 0 ? "bg-emerald" : "bg-slate"
                    }`}
                  />
                  {r.region}
                  <span className="text-faint">· {r.city.split(",")[0]}</span>
                </span>
                <span className="tabular text-ink">{usd(r.spend)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas-2">
                <motion.div
                  className={`h-full rounded-full ${
                    r.medicated > 0 ? "bg-emerald" : "bg-slate"
                  } ${isActive ? "" : "opacity-70"}`}
                  initial={false}
                  animate={{ width: `${(r.spend / max) * 100}%` }}
                  transition={{ type: "spring", stiffness: 120, damping: 20 }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-faint">
                <span>
                  {r.people} {r.people === 1 ? "person" : "people"} · {r.medicated} medicated
                </span>
                <span>{r.funded} funded</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
