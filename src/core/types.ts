/**
 * Shared types for gh-bump.
 */

// ── GitHub / Dependabot ────────────────────────────────────────────

export interface DependabotAlert {
  number: number;
  state: string;
  security_advisory: {
    ghsa_id: string;
    summary: string;
    severity: string;
    cve_id: string | null;
  };
  security_vulnerability: {
    package: {
      ecosystem: string;
      name: string;
    };
    severity: string;
    vulnerable_version_range: string;
    first_patched_version: { identifier: string } | null;
  };
  dependency: {
    package: {
      ecosystem: string;
      name: string;
    };
    manifest_path: string;
    scope: string;
  };
  html_url: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface FileChange {
  path: string;
  content: string;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink";
  size?: number;
}

// ── Agent ──────────────────────────────────────────────────────────

export interface FixPlan {
  files: FileChange[];
  prTitle: string;
  prBody: string;
  commitMessage: string;
}

export interface AgentResult {
  repo: string;
  alertsProcessed: number;
  prUrl: string | null;
  error: string | null;
}

// ── Config ─────────────────────────────────────────────────────────

export type AiProvider = "openai" | "anthropic" | "github";
export type Severity = "critical" | "high" | "medium" | "low";
export type MergeMethod = "squash" | "merge" | "rebase";

export interface Config {
  /** GitHub token with repo + security_events scope */
  githubToken: string;

  /** AI provider to use */
  aiProvider: AiProvider;

  /** API key for the AI provider */
  aiApiKey: string;

  /** Model name override (provider-specific) */
  aiModel?: string;

  /** Target repository in owner/repo format */
  repo?: string;

  /** Minimum severity to process */
  severity?: Severity;

  /** Preview mode — no mutations */
  dryRun: boolean;

  /** Merge PRs after creation */
  merge: boolean;

  /** Merge method */
  mergeMethod: MergeMethod;

  /** Create GitHub release after merge */
  release: boolean;

  /** Create git tag after merge */
  tag: boolean;

  /** Max LLM calls per run (cost guardrail) */
  maxLlmCalls: number;

  /** Max alerts to process per run */
  maxAlerts: number;
}
