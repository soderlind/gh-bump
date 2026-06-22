import test from "node:test";
import assert from "node:assert/strict";
import {
  collectOutcomeMessages,
  countByOutcome,
  summarizeAgentResults,
} from "../src/core/result-summary.ts";
import type { AgentResult } from "../src/core/types.ts";

const sampleResults: AgentResult[] = [
  {
    repo: "owner/repo",
    alertsProcessed: 2,
    prUrl: "https://github.com/owner/repo/pull/1",
    outcome: "success",
    message: null,
  },
  {
    repo: "owner/repo",
    alertsProcessed: 1,
    prUrl: null,
    outcome: "no-fix",
    message: "No safe upgrade path",
  },
  {
    repo: "owner/repo",
    alertsProcessed: 1,
    prUrl: null,
    outcome: "budget-stop",
    message: "Max LLM calls reached (20)",
  },
  {
    repo: "owner/repo",
    alertsProcessed: 1,
    prUrl: null,
    outcome: "failed",
    message: "GitHub API unavailable",
  },
];

test("summarizeAgentResults reports counts for all outcome classes", () => {
  const summary = summarizeAgentResults(sampleResults);

  assert.deepEqual(summary, {
    prsCreated: 1,
    totalAlerts: 5,
    failed: 1,
    noFix: 1,
    budgetStops: 1,
  });
});

test("countByOutcome returns class-specific totals", () => {
  assert.equal(countByOutcome(sampleResults, "success"), 1);
  assert.equal(countByOutcome(sampleResults, "no-fix"), 1);
  assert.equal(countByOutcome(sampleResults, "budget-stop"), 1);
  assert.equal(countByOutcome(sampleResults, "failed"), 1);
});

test("collectOutcomeMessages returns only populated messages for one outcome", () => {
  assert.deepEqual(collectOutcomeMessages(sampleResults, "failed"), [
    "GitHub API unavailable",
  ]);

  assert.deepEqual(collectOutcomeMessages(sampleResults, "no-fix"), [
    "No safe upgrade path",
  ]);

  assert.deepEqual(collectOutcomeMessages(sampleResults, "success"), []);
});
