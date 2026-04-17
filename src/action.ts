/**
 * gh-bump GitHub Action entrypoint.
 */

import * as core from "@actions/core";
import { GitHubClient } from "./core/github.js";
import { createLlmClient } from "./core/llm.js";
import { runAgent } from "./core/agent.js";
import type { AiProvider, Config, Severity, MergeMethod } from "./core/types.js";

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const aiProvider = (core.getInput("ai-provider") || "github") as AiProvider;
    let aiApiKey = core.getInput("ai-api-key") || undefined;

    // For github provider, fall back to github-token
    if (!aiApiKey && aiProvider === "github") {
      aiApiKey = githubToken;
    }
    if (!aiApiKey) {
      throw new Error("ai-api-key is required (or use provider=github to use github-token)");
    }

    const aiModel = core.getInput("ai-model") || undefined;
    const repo = core.getInput("repo", { required: true });
    const severity = (core.getInput("severity") || undefined) as Severity | undefined;
    const dryRun = core.getBooleanInput("dry-run");
    const merge = core.getBooleanInput("merge");
    const mergeMethod = (core.getInput("merge-method") || "squash") as MergeMethod;
    const release = core.getBooleanInput("release");
    const tag = core.getBooleanInput("tag");
    const maxAlerts = parseInt(core.getInput("max-alerts") || "10", 10);
    const maxLlmCalls = parseInt(core.getInput("max-llm-calls") || "20", 10);

    if (core.getInput("verbose") === "true") {
      process.env.VERBOSE = "true";
    }

    const config: Config = {
      githubToken,
      aiProvider,
      aiApiKey,
      aiModel,
      repo,
      severity,
      dryRun,
      merge: merge || release || tag,
      mergeMethod,
      release,
      tag,
      maxLlmCalls,
      maxAlerts,
    };

    const gh = new GitHubClient(githubToken);
    const llm = await createLlmClient(aiProvider, aiApiKey, aiModel);

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
