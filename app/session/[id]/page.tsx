import { notFound } from "next/navigation";
import { SessionClient } from "@/components/SessionClient";
import { SessionLoader } from "@/components/SessionLoader";
import { getScenario } from "@/lib/scenarios";
import { difficultySchema, type Difficulty } from "@/lib/types";

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ difficulty?: string }>;
}) {
  const { id } = await params;
  const { difficulty: rawDifficulty } = await searchParams;

  const parsed = difficultySchema.safeParse(rawDifficulty);
  const difficulty: Difficulty = parsed.success ? parsed.data : "medium";

  if (id.startsWith("custom-")) {
    return <SessionLoader id={id} difficulty={difficulty} />;
  }

  const scenario = getScenario(id);
  if (!scenario) notFound();

  return <SessionClient scenario={scenario} difficulty={difficulty} />;
}
