"use client";

import type { CustomScenario } from "./types";

const PREFIX = "parlay.custom.";

export function saveCustomScenario(scenario: CustomScenario) {
  try {
    localStorage.setItem(
      `${PREFIX}${scenario.scenario.id}`,
      JSON.stringify(scenario),
    );
  } catch {
    // storage may be unavailable
  }
}

export function loadCustomScenario(id: string): CustomScenario | null {
  try {
    const raw = localStorage.getItem(`${PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw) as CustomScenario;
  } catch {
    return null;
  }
}
