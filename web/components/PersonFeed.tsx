"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { PersonItem } from "@/lib/replay";
import { usd } from "@/lib/format";

const OUTCOME_LABEL: Record<string, string> = {
  medicated: "Medicated",
  undermedicated: "No convert",
  organic_medicated: "Organic",
};
const OUTCOME_CLASS: Record<string, string> = {
  medicated: "text-money border-money/40 bg-money/10",
  undermedicated: "text-muted border-skip/50 bg-skip/10",
  organic_medicated: "text-organic border-organic/40 bg-organic/10",
};

export default function PersonFeed({ persons }: { persons: PersonItem[] }) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Allocation by person</h2>
        <span className="text-[11px] text-muted">live · newest first</span>
      </header>
      <div className="scroll-thin -mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
        {persons.length === 0 && (
          <p className="py-6 text-center text-xs text-faint">No allocations yet.</p>
        )}
        <AnimatePresence initial={false}>
          {persons.map((p) => (
            <motion.div
              key={p.key}
              layout
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
              className="flex items-center justify-between rounded-lg border border-hairline bg-panel-2/60 px-3 py-2"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-ink">
                  {p.patientId}
                  <span className="text-faint"> · {p.diagnosis}</span>
                </span>
                <span className="truncate text-[11px] text-muted">
                  {p.region} · {p.city.split(",")[0]}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2 pl-2">
                <span className="tabular text-xs text-ink">
                  {p.amount > 0 ? usd(p.amount) : "—"}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    OUTCOME_CLASS[p.outcome] ?? OUTCOME_CLASS.undermedicated
                  }`}
                >
                  {OUTCOME_LABEL[p.outcome] ?? p.outcome}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
