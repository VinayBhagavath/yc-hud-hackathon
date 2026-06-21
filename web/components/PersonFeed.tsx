"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { PersonItem } from "@/lib/replay";
import { usd } from "@/lib/format";
import Placard from "./Placard";

const OUTCOME_LABEL: Record<string, string> = {
  medicated: "Medicated",
  undermedicated: "No convert",
  organic_medicated: "Organic",
};
const OUTCOME_CLASS: Record<string, string> = {
  medicated: "text-emerald border-emerald/40 bg-emerald/10",
  undermedicated: "text-muted border-slate/40 bg-slate/10",
  organic_medicated: "text-organic border-organic/40 bg-organic/10",
};

function gapPhrase(days: number): string {
  if (days <= 0) return "no gap";
  const months = Math.round(days / 30);
  return months >= 1 ? `${months}mo gap` : `${days}d gap`;
}

export default function PersonFeed({ persons }: { persons: PersonItem[] }) {
  return (
    <section className="panel flex min-h-0 flex-1 flex-col p-4">
      <Placard
        title="Patients reached"
        subtitle="Each allocation, newest first — one patient, one story"
      />
      <div className="scroll-thin -mr-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-2">
        {persons.length === 0 && (
          <p className="py-6 text-center text-xs text-faint">No allocations yet.</p>
        )}
        <AnimatePresence initial={false}>
          {persons.map((p) => {
            const verb = p.amount > 0 ? `funded ${usd(p.amount)}` : "organic";
            return (
              <motion.div
                key={p.key}
                layout
                initial={{ opacity: 0, x: -10, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-canvas-2/60 px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-ink">
                    {p.patientId}
                    <span className="text-faint"> · {p.diagnosis}</span>
                  </span>
                  <span className="truncate text-[11px] text-muted">
                    {gapPhrase(p.gapDays)} · {verb}
                    <span className="text-faint"> · {p.city.split(",")[0]}</span>
                  </span>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                    OUTCOME_CLASS[p.outcome] ?? OUTCOME_CLASS.undermedicated
                  }`}
                >
                  {OUTCOME_LABEL[p.outcome] ?? p.outcome}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
