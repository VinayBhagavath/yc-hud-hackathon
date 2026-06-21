"use client";

import { useEffect, useRef, useState } from "react";

// Smoothly tweens a displayed number toward `value` whenever it changes.
export function useCountUp(value: number, duration = 500): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frame = useRef<number>();

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      fromRef.current = value;
    };
  }, [value, duration]);

  return display;
}

export default function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const display = useCountUp(value);
  return <span className={className}>{format(display)}</span>;
}
