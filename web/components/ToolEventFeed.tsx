"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ToolLogItem } from "@/lib/replay";
import { usd } from "@/lib/format";

const TOOL_LABEL: Record<string, string> = {
  get_active_patients: "get_active_patients",
  get_budget_status: "get_budget_status",
  allocate_funding: "allocate_funding",
  end_round: "end_round",
  resolve_round: "resolve_round",
};
const STATUS_CLASS: Record<string, string> = {
  read: "text-[#7aa2ff]",
  queued: "text-money",
  resolved: "text-organic",
};

export default function ToolEventFeed({ toolLog }: { toolLog: ToolLogItem[] }) {
  return (
    <section className="panel flex min-h-0 flex-col p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">Agent tool calls</h2>
        <span className="text-[11px] text-muted">HUD loop</span>
      </header>
      <div className="scroll-thin -mr-2 flex max-h-44 min-h-0 flex-col gap-1 overflow-y-auto pr-2 font-mono text-[11px]">
        <AnimatePresence initial={false}>
          {toolLog.map((item) => (
            <motion.div
              key={item.key}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22 }}
              className="flex items-center gap-2 border-b border-hairline/60 py-1"
            >
              <span className="text-faint">{item.roundId}</span>
              <span className={STATUS_CLASS[item.tool.status] ?? "text-muted"}>
                {TOOL_LABEL[item.tool.tool_name] ?? item.tool.tool_name}
              </span>
              {item.tool.amount_usd != null && (
                <span className="text-ink">{usd(item.tool.amount_usd)}</span>
              )}
              <span className="truncate text-muted">{item.tool.detail}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
