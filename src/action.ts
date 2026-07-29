/**
 * gh-bump GitHub Action entrypoint.
 */

import * as core from "@actions/core";
import { GitHubClient } from "./core/github.ts";
import { createLlmClient } from "./core/llm.ts";
import { runAgent } from "./core/agent.ts";
import { runRepositoryLifecycle } from "./core/lifecycle.ts";
import { normalizeConfig } from "./core/config.ts";
import { buildRunReport } from "./core/run-report.ts";

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
    const lifecycleFailures = await runRepositoryLifecycle(gh, config, results);

    const report = buildRunReport(results, {
      dryRun: config.dryRun,
      lifecycleFailures,
    });
    const { prsCreated, totalAlerts, noFix, budgetStops, failed } =
      report.counts;

    core.setOutput("prs-created", prsCreated);
    core.setOutput("alerts-fixed", totalAlerts);
    core.setOutput("pr-urls", JSON.stringify(report.prUrls));

    core.setOutput("no-fix", noFix);
    core.setOutput("budget-stops", budgetStops);
    core.setOutput("failed", failed);
    core.setOutput("summary", report.summary);

    if (report.noFixMessages.length > 0) {
      core.warning(
        `${report.noFixMessages.length} alert group(s) produced no fix: ${report.noFixMessages.join("; ")}`
      );
    }

    if (report.failureMessages.length > 0) {
      core.warning(
        `${report.failureMessages.length} alert group(s) failed: ${report.failureMessages.join("; ")}`
      );
    }

    if (budgetStops > 0) {
      core.warning(
        `${budgetStops} alert group(s) stopped due to configured budget limits.`
      );
    }

    if (report.lifecycleFailureMessages.length > 0) {
      core.setFailed(
        `Merge, tag or release failed after the pull request was created: ${report.lifecycleFailureMessages.join("; ")}`
      );
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
