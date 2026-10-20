import type { CSSProperties } from "react";

export function Icon({
  name,
  className = "",
  style,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={`material-symbols-outlined ${className}`}
      style={style}
    >
      {name}
    </span>
  );
}
