import type { AgentResult, AgentOutcome } from "./types.js";

export interface AgentOutcomeCounts {
  prsCreated: number;
  totalAlerts: number;
  failed: number;
  noFix: number;
  budgetStops: number;
}

export function summarizeAgentResults(results: AgentResult[]): AgentOutcomeCounts {
  return {
    prsCreated: results.filter((result) => result.prUrl).length,
    totalAlerts: results.reduce(
      (sum, result) => sum + result.alertsProcessed,
      0
    ),
    failed: countByOutcome(results, "failed"),
    noFix: countByOutcome(results, "no-fix"),
    budgetStops: countByOutcome(results, "budget-stop"),
  };
}

export function countByOutcome(
  results: AgentResult[],
  outcome: AgentOutcome
): number {
  return results.filter((result) => result.outcome === outcome).length;
}

export function collectOutcomeMessages(
  results: AgentResult[],
  outcome: AgentOutcome
): string[] {
  return results
    .filter((result) => result.outcome === outcome && result.message)
    .map((result) => result.message as string);
}
