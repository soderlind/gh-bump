import test from "node:test";
import assert from "node:assert/strict";
import {
  directDependencyNames,
  getEditableManifestPath,
  groupAlertsByManifest,
  hasDirectDependency,
  isLockfilePath,
  readPackageJson,
  resolveManifestFromLockfile,
} from "../src/core/manifest.ts";
import { createAlert } from "./support/fixtures.ts";

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

test("isLockfilePath recognises the supported lockfiles", () => {
  assert.equal(isLockfilePath("package-lock.json"), true);
  assert.equal(isLockfilePath("Cargo.lock"), true);
  assert.equal(isLockfilePath("package.json"), false);
});

test("isLockfilePath matches lockfile names across ecosystems", () => {
  for (const name of [
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "Gemfile.lock",
    "Cargo.lock",
    "composer.lock",
    "poetry.lock",
    "Pipfile.lock",
    "mix.lock",
    "Podfile.lock",
    "flake.lock",
    "packages.lock.json",
    "gradle.lockfile",
    ".terraform.lock.hcl",
    "app/frontend/package-lock.json",
  ]) {
    assert.equal(isLockfilePath(name), true, name);
  }
});

test("isLockfilePath ignores 'lock' inside directory and file names", () => {
  for (const path of [
    "blocks/package.json",
    "src/blocks/package.json",
    "blockchain/go.mod",
    "unlock/requirements.txt",
    "clock-ui/composer.json",
    "blocks.json",
  ]) {
    assert.equal(isLockfilePath(path), false, path);
  }
});

test("getEditableManifestPath keeps manifests under lock-like directories", () => {
  assert.equal(
    getEditableManifestPath("blocks/package.json"),
    "blocks/package.json"
  );
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

test("readPackageJson returns null for non-object or invalid JSON", () => {
  assert.equal(readPackageJson(undefined), null);
  assert.equal(readPackageJson("not json"), null);
  assert.equal(readPackageJson("[]"), null);
  assert.deepEqual(readPackageJson('{"name":"app"}'), { name: "app" });
});

test("directDependencyNames spans every direct section", () => {
  const packageJson = readPackageJson(
    JSON.stringify({
      dependencies: { a: "1" },
      devDependencies: { b: "1" },
      optionalDependencies: { c: "1" },
      peerDependencies: { d: "1" },
      overrides: { e: "1" },
    })
  );

  assert.deepEqual([...directDependencyNames(packageJson)].sort(), [
    "a",
    "b",
    "c",
    "d",
  ]);
  assert.equal(hasDirectDependency(packageJson, "b"), true);
  assert.equal(hasDirectDependency(packageJson, "e"), false);
  assert.equal(hasDirectDependency(null, "a"), false);
});
