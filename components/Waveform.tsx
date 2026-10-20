"use client";

interface WaveformProps {
  active: boolean;
  level?: number;
  bars?: number;
  className?: string;
}

export function Waveform({
  active,
  level = 0,
  bars = 32,
  className = "",
}: WaveformProps) {
  const mid = (bars - 1) / 2;
  return (
    <div
      className={`flex h-10 items-center justify-center gap-[3px] ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }).map((_, i) => {
        const center = 1 - Math.abs(i - mid) / mid;
        const height = 6 + center * 20 + (active ? level * 12 : 0);
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full ${
              active ? "wave-bar bg-ink" : "bg-borderline"
            }`}
            style={
              active
                ? {
                    animationDelay: `${(i % 8) * 0.07}s`,
                    animationDuration: `${0.65 + (i % 5) * 0.09}s`,
                  }
                : { height: `${Math.round(height)}px` }
            }
          />
        );
      })}
    </div>
  );
}
