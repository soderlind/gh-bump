import type { LlmClient, LlmCallOptions } from "../../src/core/llm.ts";
import type { Config, DependabotAlert } from "../../src/core/types.ts";

export function createAlert(
  manifestPath: string,
  packageName: string,
  overrides: { severity?: string; ecosystem?: string; number?: number } = {}
): DependabotAlert {
  const severity = overrides.severity ?? "high";
  const ecosystem = overrides.ecosystem ?? "npm";

  return {
    number: overrides.number ?? 1,
    state: "open",
    security_advisory: {
      ghsa_id: "GHSA-test",
      summary: `${packageName} vulnerability`,
      severity,
      cve_id: null,
    },
    security_vulnerability: {
      package: { ecosystem, name: packageName },
      severity,
      vulnerable_version_range: "<1.0.1",
      first_patched_version: { identifier: "1.0.1" },
    },
    dependency: {
      package: { ecosystem, name: packageName },
      manifest_path: manifestPath,
      scope: "runtime",
    },
    html_url: "https://github.com/example/repo/security/dependabot/1",
  };
}

export function createConfig(overrides: Partial<Config> = {}): Config {
  return {
    githubToken: "token",
    aiProvider: "github",
    aiApiKey: "key",
    repo: "example/repo",
    dryRun: false,
    merge: false,
    mergeMethod: "squash",
    release: false,
    tag: false,
    maxLlmCalls: 20,
    maxAlerts: 10,
    ...overrides,
  };
}

/** LLM adapter that replays canned responses. */
export function createStubLlm(
  responses: (string | Error)[]
): LlmClient & { calls: LlmCallOptions[] } {
  const calls: LlmCallOptions[] = [];
  let index = 0;

  return {
    calls,
    async call(options: LlmCallOptions): Promise<string> {
      calls.push(options);
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
