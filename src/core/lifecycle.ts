/**
 * Downstream repository lifecycle: merge, tag, release.
 *
 * Runs after Security Remediation has produced its Terminal Remediation
 * Artifact, never inside it.
 */

import type { LifecyclePort } from "./repository.ts";
import type {
  AgentResult,
  Config,
  LifecycleFailure,
  RemediationArtifact,
} from "./types.ts";
import * as log from "./log.ts";

const VERSION_PATTERN = /\d+\.\d+\.\d+/;

export function isLifecycleRequested(config: Config): boolean {
  return config.merge || config.release || config.tag;
}

function releaseVersion(artifact: RemediationArtifact): string | null {
  return artifact.prTitle.match(VERSION_PATTERN)?.[0] ?? null;
}

async function applyToArtifact(
  gh: LifecyclePort,
  config: Config,
  artifact: RemediationArtifact
): Promise<void> {
  const merged = await gh.mergePR(
    artifact.repo,
    artifact.prNumber,
    config.mergeMethod
  );

  if (!merged) {
    return;
  }

  log.success("  PR merged");

  if (!config.tag && !config.release) {
    return;
  }

  const version = releaseVersion(artifact);
  if (!version) {
    log.warn(`  No version found in PR title: ${artifact.prTitle}`);
    return;
  }

  const mergeSha = await gh.getBranchSha(artifact.repo, artifact.defaultBranch);

  if (config.tag) {
    await gh.createTag(artifact.repo, version, mergeSha);
    log.success(`  Tag created: ${version}`);
  }

  if (config.release) {
    const releaseUrl = await gh.createRelease(artifact.repo, version, version);
    log.success(`  Release created: ${releaseUrl}`);
  }
}

/**
 * Apply lifecycle steps to every remediation artifact produced by a run.
 *
 * A failing artifact is recorded and the run continues, so an already-existing
 * tag cannot discard the report of pull requests that were created.
 */
export async function runRepositoryLifecycle(
  gh: LifecyclePort,
  config: Config,
  results: AgentResult[]
): Promise<LifecycleFailure[]> {
  const failures: LifecycleFailure[] = [];

  if (!isLifecycleRequested(config) || config.dryRun) {
    return failures;
  }

  for (const result of results) {
    if (!result.artifact) {
      continue;
    }

    try {
      await applyToArtifact(gh, config, result.artifact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`  Lifecycle failed for PR #${result.artifact.prNumber}: ${message}`);
      failures.push({
        repo: result.artifact.repo,
        prNumber: result.artifact.prNumber,
        message,
      });
    }
  }

  return failures;
}
