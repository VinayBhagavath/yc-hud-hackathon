"use client";

import type { ReplayController } from "@/lib/replay";
import { SPEEDS } from "@/lib/replay";

function PlayIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3.5" y="2.5" width="3.2" height="11" rx="1" />
      <rect x="9.3" y="2.5" width="3.2" height="11" rx="1" />
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
      <path d="M4 2.8 L13 8 L4 13.2 Z" />
    </svg>
  );
}

export default function ReplayControls({ replay }: { replay: ReplayController }) {
  const { state, index, total, playing, speed, finished, roundStarts } = replay;
  const progress = (index / Math.max(total - 1, 1)) * 100;

  return (
    <div className="panel flex items-center gap-4 px-4 py-2.5">
      <button
        onClick={finished ? replay.restart : replay.toggle}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-canvas shadow-gold transition hover:brightness-110"
        aria-label={finished ? "Replay" : playing ? "Pause" : "Play"}
      >
        {finished ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 2.5a5.5 5.5 0 1 0 5.2 3.7l-1.4.5A4 4 0 1 1 8 4v2.2l3-2.85L8 .5Z" />
          </svg>
        ) : (
          <PlayIcon playing={playing} />
        )}
      </button>

      {/* Round chips — the obvious way to re-drive a moment during Q&A. */}
      <div className="flex shrink-0 items-center gap-1">
        {roundStarts.map((_, r) => {
          const isCurrent = r === state.roundIndex;
          return (
            <button
              key={r}
              onClick={() => replay.goToRound(r)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide transition ${
                isCurrent
                  ? "bg-gold/15 text-gold ring-1 ring-gold/40"
                  : "text-muted hover:text-ink"
              }`}
            >
              R{r + 1}
            </button>
          );
        })}
      </div>

      <div className="relative flex flex-1 items-center">
        <input
          type="range"
          min={0}
          max={total - 1}
          value={index}
          onChange={(e) => replay.seek(Number(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background: `linear-gradient(to right, #c9a35b ${progress}%, #3a3122 ${progress}%)`,
          }}
          aria-label="Scrub replay"
        />
      </div>

      <span className="shrink-0 text-[11px] tracking-wide text-faint">{state.roundId}</span>

      <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-hairline bg-canvas-2 p-0.5">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => replay.setSpeed(s)}
            className={`rounded-full px-2 py-1 text-[11px] font-medium transition ${
              speed === s ? "bg-gold text-canvas" : "text-muted hover:text-ink"
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
