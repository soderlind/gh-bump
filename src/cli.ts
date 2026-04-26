#!/usr/bin/env node

/**
 * gh-bump CLI entrypoint.
 *
 * Usage:
 *   gh-bump --repo=owner/repo [options]
 *   gh-bump --repo=owner/repo --dry-run
 *   gh-bump --repo=owner/repo --severity=critical --merge --release
 *   gh-bump --full-run --dry-run
 */

import { parseArgs } from "node:util";
import { GitHubClient } from "./core/github.js";
import { createLlmClient } from "./core/llm.js";
import { runAgent } from "./core/agent.js";
import { findFullRunIncompatibleOptions } from "./core/cli-mode.js";
import { normalizeConfig } from "./core/config.js";
import { runLocalRelease } from "./core/local-release.js";
import type { Config } from "./core/types.js";
import * as log from "./core/log.js";

function showHelp(): void {
  console.log(`
gh-bump — AI-powered Dependabot security fix agent

USAGE
  gh-bump --repo=owner/repo [options]
  gh-bump --full-run [--dry-run] [--publish]

OPTIONS
  --repo=OWNER/REPO       Target repository (required)
  --full-run              Run local npm update, patch version, checks, and optional publish
  --publish               Publish to npm during --full-run (required for npm publish)
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
  GITHUB_TOKEN             GitHub token (required for Dependabot mode)
  AI_API_KEY               AI provider API key (or use --provider=github)
  OPENAI_API_KEY           OpenAI API key (fallback)
  ANTHROPIC_API_KEY        Anthropic API key (fallback)

SAFETY
  --full-run without --publish prepares and verifies the patch release only.
  npm publish runs only when --full-run and --publish are both set.

EXAMPLES
  # Local npm release dry-run: show all planned phases and commands
  gh-bump --full-run --dry-run

  # Local npm release: update lockfile, bump patch, run checks, skip publish
  gh-bump --full-run

  # Local npm release and publish
  gh-bump --full-run --publish

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

function parseCliArgs() {
  const parsed = parseArgs({
    options: {
      repo: { type: "string" },
      "full-run": { type: "boolean", default: false },
      publish: { type: "boolean", default: false },
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
    tokens: true,
  });

  return {
    values: parsed.values,
    optionNames: parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name),
  };
}

function getConfig(values: ReturnType<typeof parseCliArgs>["values"]): Config {
  return normalizeConfig({
    githubToken: process.env.GITHUB_TOKEN,
    aiProvider: values.provider,
    aiApiKey: process.env.AI_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    aiModel: values.model,
    repo: values.repo,
    severity: values.severity,
    dryRun: values["dry-run"],
    merge: values.merge,
    mergeMethod: values["merge-method"],
    release: values.release,
    tag: values.tag,
    maxLlmCalls: values["max-llm-calls"],
    maxAlerts: values["max-alerts"],
  });
}

async function main(): Promise<void> {
  const { values, optionNames } = parseCliArgs();

  if (values.help) {
    showHelp();
    process.exit(0);
  }

  if (values.verbose) {
    process.env.VERBOSE = "true";
  }

  if (values["full-run"]) {
    const incompatibleOptions = findFullRunIncompatibleOptions(optionNames);
    if (incompatibleOptions.length > 0) {
      throw new Error(
        `--full-run cannot be combined with: ${incompatibleOptions
          .map((option) => `--${option}`)
          .join(", ")}`
      );
    }

    if (values["dry-run"]) {
      console.log();
      log.warn("DRY-RUN MODE — No shell commands will be run");
      console.log();
    }

    await runLocalRelease({
      dryRun: values["dry-run"],
      publish: values.publish,
      logger: log,
    });
    return;
  }

  if (values.publish) {
    throw new Error("--publish is only supported with --full-run.");
  }

  const config = getConfig(values);

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
