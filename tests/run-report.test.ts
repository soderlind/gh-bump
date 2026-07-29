import test from "node:test";
import assert from "node:assert/strict";
import { buildRunReport } from "../src/core/run-report.ts";
import type { AgentResult } from "../src/core/types.ts";

function result(overrides: Partial<AgentResult>): AgentResult {
  return {
    repo: "example/repo",
    alertsProcessed: 1,
    prUrl: null,
    outcome: "success",
    message: null,
    artifact: null,
    ...overrides,
  };
}

test("buildRunReport counts every outcome class separately", () => {
  const report = buildRunReport([
    result({ prUrl: "https://example/pr/1", alertsProcessed: 2 }),
    result({ outcome: "no-fix", message: "no safe fix" }),
    result({ outcome: "budget-stop", message: "Max LLM calls reached (1)" }),
    result({ outcome: "failed", message: "boom" }),
  ]);

  assert.deepEqual(report.counts, {
    prsCreated: 1,
    totalAlerts: 5,
    failed: 1,
    noFix: 1,
    budgetStops: 1,
  });
  assert.deepEqual(report.prUrls, ["https://example/pr/1"]);
});

test("buildRunReport exits non-zero only on failures", () => {
  assert.equal(
    buildRunReport([result({ outcome: "no-fix", message: "x" })]).exitCode,
    0
  );
  assert.equal(
    buildRunReport([result({ outcome: "budget-stop", message: "x" })]).exitCode,
    0
  );
  assert.equal(
    buildRunReport([result({ outcome: "failed", message: "x" })]).exitCode,
    1
  );
});

test("buildRunReport still reports created PRs when the lifecycle failed", () => {
  const report = buildRunReport([result({ prUrl: "https://example/pr/1" })], {
    lifecycleFailures: [
      { repo: "example/repo", prNumber: 1, message: "tag already exists" },
    ],
  });

  assert.deepEqual(report.prUrls, ["https://example/pr/1"]);
  assert.equal(report.counts.prsCreated, 1);
  assert.deepEqual(report.lifecycleFailureMessages, [
    "example/repo#1: tag already exists",
  ]);
  assert.equal(report.exitCode, 1);
});

test("buildRunReport collects per-outcome messages", () => {
  const report = buildRunReport([
    result({ outcome: "no-fix", message: "no safe fix" }),
    result({ outcome: "failed", message: "boom" }),
  ]);

  assert.deepEqual(report.noFixMessages, ["no safe fix"]);
  assert.deepEqual(report.failureMessages, ["boom"]);
});

test("buildRunReport renders a dry-run line only in dry-run mode", () => {
  const results = [result({})];

  assert.ok(
    buildRunReport(results, { dryRun: true }).lines.some((line) =>
      line.text.includes("dry-run completed")
    )
  );
  assert.ok(
    !buildRunReport(results).lines.some((line) =>
      line.text.includes("dry-run completed")
    )
  );
});

test("buildRunReport produces one summary sentence", () => {
  const report = buildRunReport([
    result({ prUrl: "https://example/pr/1" }),
    result({ outcome: "failed", message: "boom" }),
  ]);

  assert.equal(
    report.summary,
    "Processed 2 alerts, created 1 PRs, no-fix 0, budget-stops 0, failed 1"
  );
});
