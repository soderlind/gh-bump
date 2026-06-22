/**
 * gh-bump GitHub Action entrypoint.
 */

import * as core from "@actions/core";
import { GitHubClient } from "./core/github.js";
import { createLlmClient } from "./core/llm.js";
import { runAgent } from "./core/agent.js";
import { normalizeConfig } from "./core/config.js";
import {
  collectOutcomeMessages,
  summarizeAgentResults,
} from "./core/result-summary.js";

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const aiProvider = core.getInput("ai-provider") || "github";
    const aiModel = core.getInput("ai-model") || undefined;
    const repo = core.getInput("repo", { required: true });

    if (core.getInput("verbose") === "true") {
      process.env.VERBOSE = "true";
    }

    const config = normalizeConfig({
      githubToken,
      aiProvider,
      aiApiKey: core.getInput("ai-api-key") || undefined,
      aiModel,
      repo,
      severity: core.getInput("severity") || undefined,
      dryRun: core.getBooleanInput("dry-run"),
      merge: core.getBooleanInput("merge"),
      mergeMethod: core.getInput("merge-method") || "squash",
      release: core.getBooleanInput("release"),
      tag: core.getBooleanInput("tag"),
      maxLlmCalls: core.getInput("max-llm-calls") || "20",
      maxAlerts: core.getInput("max-alerts") || "10",
    });

    const gh = new GitHubClient(githubToken);
    const llm = await createLlmClient(
      config.aiProvider,
      config.aiApiKey,
      config.aiModel
    );

    const results = await runAgent(gh, llm, config, repo);

    // Set outputs
    const {
      prsCreated,
      totalAlerts: alertsFixed,
      noFix,
      budgetStops,
      failed,
    } = summarizeAgentResults(results);
    const prUrls = results.filter((r) => r.prUrl).map((r) => r.prUrl!);

    core.setOutput("prs-created", prsCreated);
    core.setOutput("alerts-fixed", alertsFixed);
    core.setOutput("pr-urls", JSON.stringify(prUrls));

    core.setOutput("no-fix", noFix);
    core.setOutput("budget-stops", budgetStops);
    core.setOutput("failed", failed);
    core.setOutput(
      "summary",
      `Processed ${alertsFixed} alerts, created ${prsCreated} PRs, no-fix ${noFix}, budget-stops ${budgetStops}, failed ${failed}`
    );

    const noFixMessages = collectOutcomeMessages(results, "no-fix");
    if (noFixMessages.length > 0) {
      core.warning(
        `${noFixMessages.length} alert group(s) produced no fix: ${noFixMessages.join("; ")}`
      );
    }

    const failures = collectOutcomeMessages(results, "failed");
    if (failures.length > 0) {
      core.warning(
        `${failures.length} alert group(s) failed: ${failures.join("; ")}`
      );
    }

    if (budgetStops > 0) {
      core.warning(
        `${budgetStops} alert group(s) stopped due to configured budget limits.`
      );
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
