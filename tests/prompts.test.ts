import test from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, buildAlertPrompt } from "../src/core/prompts.ts";
import type { DependabotAlert } from "../src/core/types.ts";

function createAlert(manifestPath: string): DependabotAlert {
  return {
    number: 1,
    state: "open",
    security_advisory: {
      ghsa_id: "GHSA-test",
      summary: "transitive package vulnerability",
      severity: "high",
      cve_id: "CVE-2026-0001",
    },
    security_vulnerability: {
      package: {
        ecosystem: "npm",
        name: "transitive-package",
      },
      severity: "high",
      vulnerable_version_range: "<1.0.1",
      first_patched_version: { identifier: "1.0.1" },
    },
    dependency: {
      package: {
        ecosystem: "npm",
        name: "transitive-package",
      },
      manifest_path: manifestPath,
      scope: "runtime",
    },
    html_url: "https://github.com/example/repo/security/dependabot/1",
  };
}

test("SYSTEM_PROMPT forbids adding transitive packages as direct dependencies", () => {
  assert.match(
    SYSTEM_PROMPT,
    /If it is only transitive, do NOT add it to dependencies\/devDependencies\/optionalDependencies\/peerDependencies/
  );
  assert.match(SYSTEM_PROMPT, /add or merge an npm "overrides" entry/);
  assert.match(SYSTEM_PROMPT, /return a skipped fix with a reason/);
});

test("buildAlertPrompt includes editable manifest contents", () => {
  const prompt = buildAlertPrompt(
    "owner/repo",
    [createAlert("package.json")],
    new Map([
      [
        "package.json",
        JSON.stringify(
          {
            devDependencies: {
              parent: "^1.0.0",
            },
          },
          null,
          2
        ),
      ],
    ])
  );

  assert.match(prompt, /The manifest files are provided below/);
  assert.match(prompt, /- \*\*Manifest\*\*: package\.json/);
  assert.match(prompt, /#### `package\.json`/);
  assert.match(prompt, /"parent": "\^1\.0\.0"/);
});

test("buildAlertPrompt labels transitive npm packages", () => {
  const prompt = buildAlertPrompt(
    "owner/repo",
    [createAlert("package.json")],
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: {
            parent: "^1.0.0",
          },
        }),
      ],
    ])
  );

  assert.match(prompt, /Dependency relationship\*\*: transitive dependency not declared directly/);
  assert.match(prompt, /Required handling\*\*: Do not add this package to dependencies\/devDependencies/);
});
