"use client";

import type { ReplayController } from "@/lib/replay";
import { SPEEDS } from "@/lib/replay";

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.8 L13 8 L4 13.2 Z" />
    </svg>
  );
}

export default function ReplayControls({ replay }: { replay: ReplayController }) {
  const { state, index, total, playing, speed, finished } = replay;
  return (
    <div className="panel flex items-center gap-4 px-4 py-3">
      <button
        onClick={finished ? replay.restart : replay.toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-money text-canvas transition hover:brightness-110"
        aria-label={playing ? "Pause" : "Play"}
      >
        {finished ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2.5a5.5 5.5 0 1 0 5.2 3.7l-1.4.5A4 4 0 1 1 8 4v2.2l3-2.85L8 .5Z" />
          </svg>
        ) : (
          <PlayIcon playing={playing} />
        )}
      </button>

      <div className="flex min-w-[68px] flex-col leading-tight">
        <span className="text-xs font-semibold text-ink">
          Round {state.roundIndex + 1}
          <span className="text-faint"> / {state.totalRounds}</span>
        </span>
        <span className="text-[11px] text-muted">{state.roundId}</span>
      </div>

      <input
        type="range"
        min={0}
        max={total - 1}
        value={index}
        onChange={(e) => replay.seek(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-panel-2 accent-money"
        style={{
          background: `linear-gradient(to right, #34d399 ${
            (index / Math.max(total - 1, 1)) * 100
          }%, #1c2030 ${(index / Math.max(total - 1, 1)) * 100}%)`,
        }}
        aria-label="Scrub replay"
      />

      <div className="flex shrink-0 items-center gap-1 rounded-full border border-hairline bg-panel-2 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => replay.setSpeed(s)}
            className={`rounded-full px-2 py-1 text-[11px] font-medium transition ${
              speed === s ? "bg-money text-canvas" : "text-muted hover:text-ink"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
