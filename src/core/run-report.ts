/**
 * Run-level reporting: turns per-group outcomes into one report both the CLI
 * and the GitHub Action adapter emit.
 */

import type { AgentOutcome, AgentResult, LifecycleFailure } from "./types.ts";

export interface RunOutcomeCounts {
  prsCreated: number;
  totalAlerts: number;
  failed: number;
  noFix: number;
  budgetStops: number;
}

export type ReportLevel = "info" | "success" | "warn" | "error";

export interface ReportLine {
  level: ReportLevel;
  text: string;
}

export interface RunReport {
  counts: RunOutcomeCounts;
  prUrls: string[];
  lines: ReportLine[];
  summary: string;
  noFixMessages: string[];
  failureMessages: string[];
  lifecycleFailureMessages: string[];
  exitCode: number;
}

function countByOutcome(results: AgentResult[], outcome: AgentOutcome): number {
  return results.filter((result) => result.outcome === outcome).length;
}

function messagesFor(results: AgentResult[], outcome: AgentOutcome): string[] {
  return results
    .filter((result) => result.outcome === outcome && result.message)
    .map((result) => result.message as string);
}

function countOutcomes(results: AgentResult[]): RunOutcomeCounts {
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

function detailLines(results: AgentResult[], dryRun: boolean): ReportLine[] {
  const lines: ReportLine[] = [];

  for (const result of results) {
    if (result.prUrl) {
      lines.push({ level: "success", text: `${result.repo}: ${result.prUrl}` });
      continue;
    }

    switch (result.outcome) {
      case "failed":
        lines.push({
          level: "error",
          text: `${result.repo}: ${result.message ?? "Unknown failure"}`,
        });
        break;
      case "no-fix":
        lines.push({
          level: "warn",
          text: `${result.repo}: ${result.message ?? "No fix produced"}`,
        });
        break;
      case "budget-stop":
        lines.push({
          level: "warn",
          text: `${result.repo}: ${result.message ?? "Budget limit reached"}`,
        });
        break;
      default:
        if (dryRun) {
          lines.push({
            level: "info",
            text: `${result.repo}: dry-run completed`,
          });
        }
        break;
    }
  }

  return lines;
}

export function buildRunReport(
  results: AgentResult[],
  options: { dryRun?: boolean; lifecycleFailures?: LifecycleFailure[] } = {}
): RunReport {
  const counts = countOutcomes(results);
  const dryRun = options.dryRun ?? false;
  const lifecycleFailures = options.lifecycleFailures ?? [];

  const lines: ReportLine[] = [
    { level: "info", text: `Alerts processed: ${counts.totalAlerts}` },
    { level: "info", text: `PRs created:      ${counts.prsCreated}` },
  ];

  if (counts.noFix > 0) {
    lines.push({ level: "warn", text: `No fix produced: ${counts.noFix}` });
  }
  if (counts.budgetStops > 0) {
    lines.push({
      level: "warn",
      text: `Budget stops:    ${counts.budgetStops}`,
    });
  }
  if (counts.failed > 0) {
    lines.push({ level: "warn", text: `Failed:          ${counts.failed}` });
  }

  lines.push(...detailLines(results, dryRun));

  const lifecycleFailureMessages = lifecycleFailures.map(
    (failure) => `${failure.repo}#${failure.prNumber}: ${failure.message}`
  );

  for (const text of lifecycleFailureMessages) {
    lines.push({ level: "error", text: `Lifecycle failed — ${text}` });
  }

  return {
    counts,
    prUrls: results.filter((r) => r.prUrl).map((r) => r.prUrl as string),
    lines,
    summary: `Processed ${counts.totalAlerts} alerts, created ${counts.prsCreated} PRs, no-fix ${counts.noFix}, budget-stops ${counts.budgetStops}, failed ${counts.failed}`,
    noFixMessages: messagesFor(results, "no-fix"),
    failureMessages: messagesFor(results, "failed"),
    lifecycleFailureMessages,
    exitCode: counts.failed > 0 || lifecycleFailures.length > 0 ? 1 : 0,
  };
}
