export function SiteFooter({ variant = "home" }: { variant?: "home" | "session" }) {
  if (variant === "session") {
    return (
      <footer className="mt-auto w-full border-t border-borderline bg-canvas-card py-4">
        <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-3 px-4 text-xs text-ink-muted sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 font-display font-bold text-ink">
            <span className="inline-block h-2 w-2 rounded-full bg-ink" />
            Parlayy Voice Rehearsal Engine
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center">
            <span className="whitespace-nowrap transition-colors hover:text-ink">
              Confidentiality Protocol
            </span>
            <span className="whitespace-nowrap transition-colors hover:text-ink">
              Session Security
            </span>
            <span className="whitespace-nowrap transition-colors hover:text-ink">
              Export Transcript
            </span>
          </div>
        </div>
      </footer>
    );
  }

  return (
    <footer className="w-full border-t border-borderline bg-canvas py-8">
      <div className="mx-auto flex max-w-[1240px] flex-col items-center justify-between gap-4 px-6 sm:flex-row sm:px-8">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-display text-lg font-extrabold tracking-tight text-ink">
            <span className="inline-block h-2 w-2 rounded-full bg-ink" />
            Parlayy
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-6">
          <span className="text-[12px] text-ink-muted transition-colors hover:text-ink">
            Confidentiality Protocol
          </span>
          <span className="text-[12px] text-ink-muted transition-colors hover:text-ink">
            Institutional Licensing
          </span>
          <span className="text-[12px] text-ink-muted transition-colors hover:text-ink">
            Terms of Engagement
          </span>
        </div>
      </div>
    </footer>
  );
}
