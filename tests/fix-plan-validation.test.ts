import test from "node:test";
import assert from "node:assert/strict";
import { validateFixPlan } from "../src/core/fix-plan-validation.ts";
import type { DependabotAlert, FixPlan } from "../src/core/types.ts";

function createAlert(packageName: string): DependabotAlert {
  return {
    number: 1,
    state: "open",
    security_advisory: {
      ghsa_id: "GHSA-test",
      summary: `${packageName} vulnerability`,
      severity: "high",
      cve_id: null,
    },
    security_vulnerability: {
      package: {
        ecosystem: "npm",
        name: packageName,
      },
      severity: "high",
      vulnerable_version_range: "<1.0.1",
      first_patched_version: { identifier: "1.0.1" },
    },
    dependency: {
      package: {
        ecosystem: "npm",
        name: packageName,
      },
      manifest_path: "package.json",
      scope: "runtime",
    },
    html_url: "https://github.com/example/repo/security/dependabot/1",
  };
}

test("validateFixPlan rejects new direct dependencies", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            app: "^1.0.0",
            transitive: "^1.0.1",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const error = validateFixPlan(
    plan,
    [createAlert("transitive")],
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: {
            app: "^1.0.0",
          },
        }),
      ],
    ])
  );

  assert.match(error ?? "", /adds new direct npm package\(s\): transitive/);
});

test("validateFixPlan rejects unrelated new direct dependencies", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            app: "^1.0.0",
            unrelated: "^1.0.0",
          },
          devDependencies: {
            vite: "^5.4.19",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const error = validateFixPlan(
    plan,
    [createAlert("transitive")],
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: {
            app: "^1.0.0",
          },
        }),
      ],
    ])
  );

  assert.match(error ?? "", /adds new direct npm package\(s\): unrelated, vite/);
});

test("validateFixPlan allows overrides for transitive alert packages", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            app: "^1.0.0",
          },
          overrides: {
            transitive: "1.0.1",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const error = validateFixPlan(
    plan,
    [createAlert("transitive")],
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: {
            app: "^1.0.0",
          },
        }),
      ],
    ])
  );

  assert.equal(error, null);
});
