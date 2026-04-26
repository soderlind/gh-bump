import test from "node:test";
import assert from "node:assert/strict";
import {
  createBranchName,
  hasLlmCallBudget,
  validatePlanFileScope,
} from "../src/core/agent-safety.ts";
import {
  getEditableManifestPath,
  groupAlertsByManifest,
  resolveManifestFromLockfile,
} from "../src/core/manifest.ts";
import type { DependabotAlert } from "../src/core/types.ts";

function createAlert(manifestPath: string, packageName: string): DependabotAlert {
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
      manifest_path: manifestPath,
      scope: "runtime",
    },
    html_url: "https://github.com/example/repo/security/dependabot/1",
  };
}

test("resolveManifestFromLockfile maps lockfiles in root and subdirectories", () => {
  assert.equal(resolveManifestFromLockfile("package-lock.json"), "package.json");
  assert.equal(
    resolveManifestFromLockfile("plugins/example/package-lock.json"),
    "plugins/example/package.json"
  );
});

test("getEditableManifestPath returns manifest paths unchanged", () => {
  assert.equal(getEditableManifestPath("package.json"), "package.json");
  assert.equal(getEditableManifestPath("composer.json"), "composer.json");
});

test("groupAlertsByManifest groups lockfile alerts by editable manifest", () => {
  const groups = groupAlertsByManifest([
    createAlert("package-lock.json", "axios"),
    createAlert("package.json", "lodash"),
  ]);
  const packageJsonAlerts = groups.get("package.json") ?? [];

  assert.deepEqual([...groups.keys()], ["package.json"]);
  assert.equal(packageJsonAlerts.length, 2);
  assert.deepEqual(
    packageJsonAlerts.map((alert) => alert.dependency.manifest_path),
    ["package.json", "package.json"]
  );
  assert.deepEqual(
    packageJsonAlerts.map((alert) => alert.dependency.package.name),
    ["axios", "lodash"]
  );
});

test("hasLlmCallBudget enforces configured call limits", () => {
  assert.equal(hasLlmCallBudget(0, 1), true);
  assert.equal(hasLlmCallBudget(1, 1), false);
});

test("validatePlanFileScope rejects lockfile edits", () => {
  const error = validatePlanFileScope(
    [{ path: "package-lock.json" }],
    new Set(["package.json"])
  );

  assert.match(error ?? "", /attempts to edit lockfile: package-lock\.json/);
});

test("validatePlanFileScope rejects edits outside fetched manifest files", () => {
  const error = validatePlanFileScope(
    [{ path: "src/index.ts" }],
    new Set(["package.json"])
  );

  assert.match(error ?? "", /outside fetched manifest set: src\/index\.ts/);
});

test("validatePlanFileScope allows fetched manifest edits", () => {
  assert.equal(
    validatePlanFileScope([{ path: "package.json" }], new Set(["package.json"])),
    null
  );
});

test("createBranchName includes manifest slug and unique suffix", () => {
  assert.equal(
    createBranchName("plugins/example/package.json", 1_776_000_000_000),
    "gh-bump/2026-04-12/plugins-example-package.json-mnvsjmdc"
  );
});
