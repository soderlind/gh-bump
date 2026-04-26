/**
 * gh-bump GitHub Action entrypoint.
 */

import * as core from "@actions/core";
import { GitHubClient } from "./core/github.js";
import { createLlmClient } from "./core/llm.js";
import { runAgent } from "./core/agent.js";
import { normalizeConfig } from "./core/config.js";

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
    const prsCreated = results.filter((r) => r.prUrl).length;
    const alertsFixed = results.reduce((sum, r) => sum + r.alertsProcessed, 0);
    const prUrls = results.filter((r) => r.prUrl).map((r) => r.prUrl!);

    core.setOutput("prs-created", prsCreated);
    core.setOutput("alerts-fixed", alertsFixed);
    core.setOutput("pr-urls", JSON.stringify(prUrls));
    core.setOutput(
      "summary",
      `Processed ${alertsFixed} alerts, created ${prsCreated} PRs`
    );

    // Fail if any errors
    const errors = results.filter((r) => r.error);
    if (errors.length > 0) {
      core.warning(
        `${errors.length} alert group(s) had errors: ${errors.map((e) => e.error).join("; ")}`
      );
    }
  } catch (err) {
    core.setFailed(err instanceof Error ? err.message : String(err));
  }
}

run();
