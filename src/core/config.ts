/**
 * Config normalization for CLI and GitHub Action adapters.
 */

import type { AiProvider, Config, MergeMethod, Severity } from "./types.js";

const AI_PROVIDERS = ["openai", "anthropic", "github"] as const;
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const MERGE_METHODS = ["squash", "merge", "rebase"] as const;

export interface ConfigInput {
  githubToken?: string;
  aiProvider?: string;
  aiApiKey?: string;
  openAiApiKey?: string;
  anthropicApiKey?: string;
  aiModel?: string;
  repo?: string;
  severity?: string;
  dryRun?: boolean;
  merge?: boolean;
  mergeMethod?: string;
  release?: boolean;
  tag?: boolean;
  maxLlmCalls?: string | number;
  maxAlerts?: string | number;
}

function isOneOf<T extends readonly string[]>(
  value: string,
  allowed: T
): value is T[number] {
  return (allowed as readonly string[]).includes(value);
}

function parsePositiveInteger(value: string | number | undefined, name: string): number {
  const parsed = typeof value === "number" ? value : parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function normalizeProvider(value: string | undefined): AiProvider {
  const provider = value ?? "github";
  if (!isOneOf(provider, AI_PROVIDERS)) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return provider;
}

function normalizeSeverity(value: string | undefined): Severity | undefined {
  if (!value) return undefined;
  if (!isOneOf(value, SEVERITIES)) {
    throw new Error(`Unsupported severity: ${value}`);
  }
  return value;
}

function normalizeMergeMethod(value: string | undefined): MergeMethod {
  const method = value ?? "squash";
  if (!isOneOf(method, MERGE_METHODS)) {
    throw new Error(`Unsupported merge method: ${method}`);
  }
  return method;
}

function resolveAiApiKey(input: ConfigInput, provider: AiProvider): string {
  const key =
    input.aiApiKey ??
    (provider === "openai"
      ? input.openAiApiKey
      : provider === "anthropic"
        ? input.anthropicApiKey
        : undefined) ??
    (provider === "github" ? input.githubToken : undefined);

  if (!key) {
    throw new Error(
      provider === "github"
        ? "GITHUB_TOKEN is required for the github provider."
        : "AI_API_KEY environment variable is required (or OPENAI_API_KEY / ANTHROPIC_API_KEY)."
    );
  }

  return key;
}

export function normalizeConfig(input: ConfigInput): Config {
  if (!input.repo) {
    throw new Error("--repo is required. Run gh-bump --help for usage.");
  }

  if (!input.githubToken) {
    throw new Error("GITHUB_TOKEN environment variable is required.");
  }

  const aiProvider = normalizeProvider(input.aiProvider);
  const release = input.release ?? false;
  const tag = input.tag ?? false;
  const merge = input.merge || release || tag || false;

  return {
    githubToken: input.githubToken,
    aiProvider,
    aiApiKey: resolveAiApiKey(input, aiProvider),
    aiModel: input.aiModel,
    repo: input.repo,
    severity: normalizeSeverity(input.severity),
    dryRun: input.dryRun ?? false,
    merge,
    mergeMethod: normalizeMergeMethod(input.mergeMethod),
    release,
    tag,
    maxLlmCalls: parsePositiveInteger(input.maxLlmCalls ?? "20", "maxLlmCalls"),
    maxAlerts: parsePositiveInteger(input.maxAlerts ?? "10", "maxAlerts"),
  };
}
