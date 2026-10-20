"use client";

import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon = "analytics",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-md animate-fade-up flex-col gap-4 rounded-2xl border border-borderline bg-canvas-card p-6 shadow-2xl outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white">
            <Icon name={icon} className="text-xl" />
          </div>
          <div>
            <h2 className="text-base font-bold text-ink">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {children ? (
          <div className="text-sm leading-relaxed text-ink-muted">
            {children}
          </div>
        ) : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2.5 border-t border-borderline-light pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
