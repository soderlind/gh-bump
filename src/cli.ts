#!/usr/bin/env node

/**
 * gh-bump CLI entrypoint.
 *
 * Usage:
 *   gh-bump --repo=owner/repo [options]
 *   gh-bump --repo=owner/repo --dry-run
 *   gh-bump --repo=owner/repo --severity=critical --merge --release
 */

import { parseArgs } from "node:util";
import { GitHubClient } from "./core/github.js";
import { createLlmClient } from "./core/llm.js";
import { runAgent } from "./core/agent.js";
import type { AiProvider, Config, Severity, MergeMethod } from "./core/types.js";
import * as log from "./core/log.js";

function showHelp(): void {
  console.log(`
gh-bump — AI-powered Dependabot security fix agent

USAGE
  gh-bump --repo=owner/repo [options]

OPTIONS
  --repo=OWNER/REPO       Target repository (required)
  --severity=LEVEL         Minimum severity: critical, high, medium, low
  --dry-run                Preview changes without applying them
  --merge                  Merge PR after creation
  --merge-method=METHOD    Merge method: squash (default), merge, rebase
  --release                Create GitHub release after merge (implies --merge)
  --tag                    Create git tag after merge (implies --merge)
  --provider=PROVIDER      AI provider: github (default), openai, anthropic
  --model=MODEL            AI model override
  --max-alerts=N           Max alerts to process per run (default: 10)
  --max-llm-calls=N        Max LLM calls per run (default: 20)
  --verbose                Enable debug output
  --help                   Show this help

ENVIRONMENT
  GITHUB_TOKEN             GitHub token (required)
  AI_API_KEY               AI provider API key (or use --provider=github)
  OPENAI_API_KEY           OpenAI API key (fallback)
  ANTHROPIC_API_KEY        Anthropic API key (fallback)

EXAMPLES
  # Dry-run: see what would be fixed
  gh-bump --repo=myorg/myapp --dry-run

  # Fix critical alerts and merge
  gh-bump --repo=myorg/myapp --severity=critical --merge

  # Fix, merge, tag, and release
  gh-bump --repo=myorg/myapp --merge --release --tag

  # Use GitHub Models (no separate AI key needed)
  gh-bump --repo=myorg/myapp --provider=github

  # Use Anthropic instead of OpenAI
  gh-bump --repo=myorg/myapp --provider=anthropic --model=claude-sonnet-4-20250514
`);
}

function getConfig(): Config {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      severity: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      merge: { type: "boolean", default: false },
      "merge-method": { type: "string", default: "squash" },
      release: { type: "boolean", default: false },
      tag: { type: "boolean", default: false },
      provider: { type: "string", default: "github" },
      model: { type: "string" },
      "max-alerts": { type: "string", default: "10" },
      "max-llm-calls": { type: "string", default: "20" },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.verbose) {
    process.env.VERBOSE = "true";
  }

  if (!values.repo) {
    log.error("--repo is required. Run gh-bump --help for usage.");
    process.exit(1);
  }

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    log.error("GITHUB_TOKEN environment variable is required.");
    process.exit(1);
  }

  const provider = (values.provider ?? "github") as AiProvider;

  // Resolve AI API key: AI_API_KEY > provider-specific env var > GITHUB_TOKEN for github provider
  let aiApiKey =
    process.env.AI_API_KEY ??
    (provider === "openai"
      ? process.env.OPENAI_API_KEY
      : provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : undefined);

  // For github provider, fall back to GITHUB_TOKEN
  if (!aiApiKey && provider === "github") {
    aiApiKey = githubToken;
  }

  if (!aiApiKey) {
    log.error(
      provider === "github"
        ? "GITHUB_TOKEN is required for the github provider."
        : "AI_API_KEY environment variable is required (or OPENAI_API_KEY / ANTHROPIC_API_KEY)."
    );
    process.exit(1);
  }

  const merge = values.merge || values.release || values.tag || false;

  return {
    githubToken,
    aiProvider: provider,
    aiApiKey,
    aiModel: values.model,
    repo: values.repo,
    severity: values.severity as Severity | undefined,
    dryRun: values["dry-run"] ?? false,
    merge,
    mergeMethod: (values["merge-method"] ?? "squash") as MergeMethod,
    release: values.release ?? false,
    tag: values.tag ?? false,
    maxLlmCalls: parseInt(values["max-llm-calls"] ?? "20", 10),
    maxAlerts: parseInt(values["max-alerts"] ?? "10", 10),
  };
}

async function main(): Promise<void> {
  const config = getConfig();

  if (config.dryRun) {
    console.log();
    log.warn("DRY-RUN MODE — No changes will be made");
    console.log();
  }

  const gh = new GitHubClient(config.githubToken);
  const llm = await createLlmClient(
    config.aiProvider,
    config.aiApiKey,
    config.aiModel
  );

  const results = await runAgent(gh, llm, config, config.repo!);

  // Summary
  console.log();
  log.group("Summary");
  const prsCreated = results.filter((r) => r.prUrl).length;
  const failed = results.filter((r) => r.error).length;
  const totalAlerts = results.reduce((sum, r) => sum + r.alertsProcessed, 0);

  log.info(`Alerts processed: ${totalAlerts}`);
  log.info(`PRs created:      ${prsCreated}`);
  if (failed > 0) log.warn(`Failed:           ${failed}`);

  for (const r of results) {
    if (r.prUrl) {
      log.success(`  ${r.repo}: ${r.prUrl}`);
    } else if (r.error) {
      log.error(`  ${r.repo}: ${r.error}`);
    }
  }
  log.groupEnd();

  // Exit with error code if any failures
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
