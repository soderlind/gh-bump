/**
 * Security Remediation: turns Dependabot alerts into remediation pull requests.
 *
 * The context ends at the Terminal Remediation Artifact — merge, tag and
 * release are downstream lifecycle concerns (see docs/adr/0001).
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { RepositoryPort } from "./repository.ts";
import type { LlmClient } from "./llm.ts";
import type {
  AgentResult,
  Config,
  DependabotAlert,
  RemediationArtifact,
} from "./types.ts";
import { formatFixPlanSummary, summarizeFixPlan } from "./fix-plan-summary.ts";
import { reviewFixPlan } from "./fix-plan-review.ts";
import {
  groupAlertsByManifest,
  isLockfilePath,
  isVerifiableManifestPath,
} from "./manifest.ts";
import { SYSTEM_PROMPT, buildAlertPrompt } from "./prompts.ts";
import * as log from "./log.ts";

function createResult(
  repo: string,
  alertsProcessed: number,
  outcome: AgentResult["outcome"],
  artifact: RemediationArtifact | null,
  message: string | null = null
): AgentResult {
  return {
    repo,
    alertsProcessed,
    prUrl: artifact?.prUrl ?? null,
    outcome,
    message,
    artifact,
  };
}

function createBranchName(manifest: string, now = Date.now()): string {
  const safeName = manifest.replace(/[/\\]/g, "-").replace(/\.lock$/, "");
  const date = new Date(now).toISOString().slice(0, 10);
  const suffix = now.toString(36);

  return `gh-bump/${date}/${safeName}-${suffix}`;
}

/**
 * Create LLM tools that let the agent read repository files.
 */
function createAgentTools(gh: RepositoryPort, repo: string, ref: string) {
  return {
    read_file: tool({
      description:
        "Read the contents of a file from the repository. Use this to inspect manifest files, lockfiles, or any source file.",
      inputSchema: zodSchema(
        z.object({
          path: z
            .string()
            .describe("File path relative to repository root, e.g. package.json"),
        })
      ),
      execute: async ({ path }: { path: string }) => {
        try {
          const content = await gh.getFileContent(repo, path, ref);
          return content;
        } catch {
          return `Error: Could not read file '${path}'. It may not exist.`;
        }
      },
    }),
    list_directory: tool({
      description:
        "List files and directories at a given path in the repository. Use this to explore project structure.",
      inputSchema: zodSchema(
        z.object({
          path: z
            .string()
            .describe(
              "Directory path relative to repository root. Use empty string or '.' for root."
            ),
        })
      ),
      execute: async ({ path }: { path: string }) => {
        try {
          const dirPath = path === "." || path === "" ? "" : path;
          const entries = await gh.listDirectory(repo, dirPath, ref);
          return entries
            .map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`)
            .join("\n");
        } catch {
          return `Error: Could not list directory '${path}'.`;
        }
      },
    }),
  };
}

async function fetchEditableManifests(
  gh: RepositoryPort,
  repo: string,
  ref: string,
  alerts: DependabotAlert[]
): Promise<Map<string, string>> {
  const fetched = new Map<string, string>();

  for (const path of new Set(alerts.map((a) => a.dependency.manifest_path))) {
    if (isLockfilePath(path)) {
      log.debug(`  Skipping lockfile: ${path}`);
      continue;
    }

    try {
      fetched.set(path, await gh.getFileContent(repo, path, ref));
      log.debug(`  Pre-fetched: ${path}`);
    } catch {
      log.warn(`  Could not fetch: ${path}`);
    }
  }

  return fetched;
}

/**
 * Run the agent for a single repository.
 */
export async function runAgent(
  gh: RepositoryPort,
  llm: LlmClient,
  config: Config,
  repo: string
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];
  let llmCalls = 0;

  // 1. Fetch alerts
  log.group(`Processing ${repo}`);
  const alerts = await gh.listAlerts(repo, config.severity);

  if (alerts.length === 0) {
    log.info("No open Dependabot alerts");
    log.groupEnd();
    return [
      createResult(repo, 0, "success", null),
    ];
  }

  log.info(`Found ${alerts.length} open alert(s)`);

  // Apply maxAlerts cap
  const alertsToProcess = alerts.slice(0, config.maxAlerts);
  if (alerts.length > config.maxAlerts) {
    log.warn(
      `Processing only ${config.maxAlerts} of ${alerts.length} alerts (--max-alerts)`
    );
  }

  // 2. Get default branch and its SHA
  const defaultBranch = await gh.getDefaultBranch(repo);
  const baseSha = await gh.getBranchSha(repo, defaultBranch);

  // 3. Group alerts by manifest and process each group
  const groups = groupAlertsByManifest(alertsToProcess);

  // Determine if we should use tools (providers that support function calling)
  const useTools = config.aiProvider !== "github";

  for (const [manifest, groupAlerts] of groups) {
    log.info(
      `\n  Manifest: ${manifest} (${groupAlerts.length} alert(s))`
    );

    if (config.merge && !isVerifiableManifestPath(manifest)) {
      const msg = `Unattended merging requires content verification, but ${manifest} is not a verifiable manifest. Disable merging to create a pull request for human review.`;
      log.warn(`  No fix produced for this group: ${msg}`);
      results.push(
        createResult(repo, groupAlerts.length, "no-fix", null, msg)
      );
      continue;
    }

    const fetchedManifests = await fetchEditableManifests(
      gh,
      repo,
      defaultBranch,
      groupAlerts
    );
    const prompt = buildAlertPrompt(repo, groupAlerts, fetchedManifests);
    const tools = useTools
      ? createAgentTools(gh, repo, defaultBranch)
      : undefined;

    if (llmCalls >= config.maxLlmCalls) {
      const msg = `Max LLM calls reached (${config.maxLlmCalls})`;
      log.error(msg);
      results.push(
        createResult(repo, groupAlerts.length, "budget-stop", null, msg)
      );
      continue;
    }

    let response: string;
    try {
      llmCalls += 1;
      response = await llm.call({ system: SYSTEM_PROMPT, prompt, tools });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`LLM call failed: ${msg}`);
      results.push(createResult(repo, groupAlerts.length, "failed", null, msg));
      continue;
    }

    const review = reviewFixPlan(response, groupAlerts, fetchedManifests);

    if (!review.admitted) {
      log.warn(`  No fix produced for this group: ${review.reason}`);
      if (review.raw) {
        log.debug(`Raw response: ${review.raw}`);
      }
      results.push(
        createResult(repo, groupAlerts.length, "no-fix", null, review.reason)
      );
      continue;
    }

    const plan = review.plan;
    log.info(`  Fix plan: ${plan.files.length} file(s) to update`);

    if (config.dryRun) {
      for (const f of plan.files) {
        log.dryRun(`  Would update: ${f.path}`);
      }
      for (const line of formatFixPlanSummary(
        summarizeFixPlan(plan, fetchedManifests)
      )) {
        log.dryRun(`  ${line}`);
      }
      log.dryRun(`  PR title: ${plan.prTitle}`);
      results.push(createResult(repo, groupAlerts.length, "success", null));
      continue;
    }

    const branchName = createBranchName(manifest);

    try {
      await gh.createBranch(repo, branchName, baseSha);
      await gh.commitFiles(
        repo,
        branchName,
        plan.files,
        plan.commitMessage,
        baseSha
      );

      const pr = await gh.createPR(
        repo,
        plan.prTitle,
        plan.prBody,
        branchName,
        defaultBranch
      );

      log.success(`  PR created: ${pr.url}`);

      results.push(
        createResult(repo, groupAlerts.length, "success", {
          repo,
          prNumber: pr.number,
          prUrl: pr.url,
          prTitle: plan.prTitle,
          defaultBranch,
        })
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`  Failed to create PR: ${msg}`);
      results.push(createResult(repo, groupAlerts.length, "failed", null, msg));
    }
  }

  log.groupEnd();
  return results;
}
