/**
 * AI agent loop: orchestrates LLM + GitHub API to fix Dependabot alerts.
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import type { GitHubClient } from "./github.js";
import type { LlmClient } from "./llm.js";
import type {
  AgentResult,
  Config,
  DependabotAlert,
  FixPlan,
} from "./types.js";
import { SYSTEM_PROMPT, buildAlertPrompt } from "./prompts.js";
import * as log from "./log.js";

/**
 * Group alerts by manifest file so we make one PR per manifest.
 */
function groupAlertsByManifest(
  alerts: DependabotAlert[]
): Map<string, DependabotAlert[]> {
  const groups = new Map<string, DependabotAlert[]>();
  for (const alert of alerts) {
    const key = alert.dependency.manifest_path;
    const group = groups.get(key) ?? [];
    group.push(alert);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Parse the LLM response JSON into a FixPlan.
 */
function parseFixPlan(text: string): FixPlan | null {
  // Extract JSON from markdown code fences if present
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  try {
    const parsed = JSON.parse(jsonStr.trim());

    if (!parsed.files || parsed.files.length === 0) {
      if (parsed.reason) {
        log.warn(`LLM skipped fix: ${parsed.reason}`);
      }
      return null;
    }

    return {
      files: parsed.files,
      prTitle: parsed.prTitle || "fix(deps): security dependency update",
      prBody: parsed.prBody || "Automated security fix by gh-bump.",
      commitMessage:
        parsed.commitMessage || "fix(deps): security dependency update",
    };
  } catch {
    log.error(`Failed to parse LLM response as JSON`);
    log.debug(`Raw response: ${text}`);
    return null;
  }
}

/**
 * Create LLM tools that let the agent read repository files.
 */
function createAgentTools(gh: GitHubClient, repo: string, ref: string) {
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

/**
 * Run the agent for a single repository.
 */
export async function runAgent(
  gh: GitHubClient,
  llm: LlmClient,
  config: Config,
  repo: string
): Promise<AgentResult[]> {
  const results: AgentResult[] = [];

  // 1. Fetch alerts
  log.group(`Processing ${repo}`);
  const alerts = await gh.listAlerts(repo, config.severity);

  if (alerts.length === 0) {
    log.info("No open Dependabot alerts");
    log.groupEnd();
    return [
      { repo, alertsProcessed: 0, prUrl: null, error: null },
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

  for (const [manifest, groupAlerts] of groups) {
    log.info(
      `\n  Manifest: ${manifest} (${groupAlerts.length} alert(s))`
    );

    // Build prompt
    const prompt = buildAlertPrompt(repo, groupAlerts);

    // Create tools for the LLM
    const tools = createAgentTools(gh, repo, defaultBranch);

    // Call LLM with tool-use loop
    let response: string;
    try {
      response = await llm.call({
        system: SYSTEM_PROMPT,
        prompt,
        tools,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`LLM call failed: ${msg}`);
      results.push({
        repo,
        alertsProcessed: groupAlerts.length,
        prUrl: null,
        error: msg,
      });
      continue;
    }

    // Parse the fix plan
    const plan = parseFixPlan(response);

    if (!plan) {
      log.warn("  No fix produced for this group");
      results.push({
        repo,
        alertsProcessed: groupAlerts.length,
        prUrl: null,
        error: "No fix plan from LLM",
      });
      continue;
    }

    log.info(
      `  Fix plan: ${plan.files.length} file(s) to update`
    );

    // Dry-run: just show what would happen
    if (config.dryRun) {
      for (const f of plan.files) {
        log.dryRun(`  Would update: ${f.path}`);
      }
      log.dryRun(`  PR title: ${plan.prTitle}`);
      results.push({
        repo,
        alertsProcessed: groupAlerts.length,
        prUrl: null,
        error: null,
      });
      continue;
    }

    // 4. Create branch, commit, and PR
    const branchName = `gh-bump/${new Date().toISOString().slice(0, 10)}/${manifest.replace(/[/\\]/g, "-")}`;

    try {
      await gh.createBranch(repo, branchName, baseSha);

      const commitSha = await gh.commitFiles(
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

      // Optional: merge
      if (config.merge || config.release || config.tag) {
        const merged = await gh.mergePR(
          repo,
          pr.number,
          config.mergeMethod
        );

        if (merged) {
          log.success("  PR merged");

          // Get merge commit SHA for tagging
          const mergeSha = await gh.getBranchSha(repo, defaultBranch);

          if (config.tag) {
            // Extract version from PR title if available
            const versionMatch = plan.prTitle.match(
              /\d+\.\d+\.\d+/
            );
            if (versionMatch) {
              await gh.createTag(repo, versionMatch[0], mergeSha);
              log.success(`  Tag created: ${versionMatch[0]}`);
            }
          }

          if (config.release) {
            const versionMatch = plan.prTitle.match(
              /\d+\.\d+\.\d+/
            );
            if (versionMatch) {
              const releaseUrl = await gh.createRelease(
                repo,
                versionMatch[0],
                versionMatch[0]
              );
              log.success(`  Release created: ${releaseUrl}`);
            }
          }
        }
      }

      results.push({
        repo,
        alertsProcessed: groupAlerts.length,
        prUrl: pr.url,
        error: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`  Failed to create PR: ${msg}`);
      results.push({
        repo,
        alertsProcessed: groupAlerts.length,
        prUrl: null,
        error: msg,
      });
    }
  }

  log.groupEnd();
  return results;
}
