"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { loadCustomScenario } from "@/lib/custom-scenario";
import type { CustomScenario, Difficulty } from "@/lib/types";
import { SessionClient } from "./SessionClient";

export function SessionLoader({
  id,
  difficulty,
}: {
  id: string;
  difficulty: Difficulty;
}) {
  const [loaded, setLoaded] = useState<CustomScenario | null | undefined>(
    undefined,
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe read from browser storage
    setLoaded(loadCustomScenario(id));
  }, [id]);

  if (loaded === undefined) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#FAFAFA] text-sm text-ink-muted">
        Loading scenario…
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <p className="text-sm text-ink-muted">
          This scenario isn&apos;t stored on this device.
        </p>
        <Link
          href={"/" as Route}
          className="mt-6 rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-canvas"
        >
          Build a new scenario
        </Link>
      </div>
    );
  }

  return (
    <SessionClient
      scenario={loaded.scenario}
      difficulty={difficulty}
      customScenario={loaded}
    />
  );
}
