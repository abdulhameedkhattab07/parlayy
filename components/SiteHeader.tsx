import Link from "next/link";
import type { Route } from "next";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-borderline/80 bg-canvas/90 backdrop-blur-md">
      <div className="mx-auto flex h-18 max-w-[1240px] items-center justify-between px-6 py-4 sm:px-8">
        <div className="flex items-baseline gap-3">
          <Link
            href={"/" as Route}
            className="flex items-center gap-2 font-display text-2xl font-extrabold tracking-tight text-ink transition-opacity hover:opacity-80 sm:text-[24px]"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-ink" />
            Parlayy
          </Link>
          <span className="hidden font-light text-borderline md:inline-block">
            /
          </span>
          <span className="hidden text-[13px] font-normal tracking-wide text-ink-muted md:inline-block">
            Voice rehearsal for high-stakes conversations
          </span>
        </div>
        <nav className="flex items-center gap-6">
          <a
            href="#how-it-works"
            className="text-[13px] font-medium tracking-wide text-ink-muted transition-colors hover:text-ink"
          >
            How it works
          </a>
        </nav>
      </div>
    </header>
  );
}
