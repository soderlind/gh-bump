import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLocalReleasePlan,
  getNextPatchVersion,
  runLocalRelease,
  type CommandRunner,
  type LocalReleaseLogger,
} from "../src/core/local-release.ts";

const noopLogger: LocalReleaseLogger = {
  info: () => undefined,
  success: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  dryRun: () => undefined,
  group: () => undefined,
  groupEnd: () => undefined,
};

async function createPackage(files: Record<string, string>): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "gh-bump-local-release-"));

  for (const [file, content] of Object.entries(files)) {
    await writeFile(join(cwd, file), content);
  }

  return cwd;
}

test("getNextPatchVersion increments stable and prerelease patch versions", () => {
  assert.equal(getNextPatchVersion("1.2.3"), "1.2.4");
  assert.equal(getNextPatchVersion("1.2.3-beta.1"), "1.2.4");
});

test("createLocalReleasePlan detects npm from package-lock.json", async () => {
  const cwd = await createPackage({
    "package.json": JSON.stringify({
      name: "example-package",
      version: "2.3.4",
      scripts: {
        test: "node --test",
        "build:check": "tsc --noEmit",
        build: "node build.js",
      },
    }),
    "package-lock.json": "{}\n",
  });

  const plan = await createLocalReleasePlan(cwd, true);

  assert.equal(plan.packageName, "example-package");
  assert.equal(plan.currentVersion, "2.3.4");
  assert.equal(plan.nextVersion, "2.3.5");
  assert.equal(plan.packageManager, "npm");
  assert.deepEqual(
    plan.commands.map((command) => [command.command, command.args]),
    [
      ["npm", ["update", "--package-lock-only"]],
      ["npm", ["version", "patch", "--no-git-tag-version"]],
      ["npm", ["test"]],
      ["npm", ["run", "build:check"]],
      ["npm", ["run", "build"]],
      ["npm", ["publish"]],
    ]
  );
});

test("createLocalReleasePlan detects npm from packageManager", async () => {
  const cwd = await createPackage({
    "package.json": JSON.stringify({
      name: "example-package",
      version: "0.1.0",
      packageManager: "npm@10.0.0",
    }),
  });

  const plan = await createLocalReleasePlan(cwd);

  assert.equal(plan.packageManager, "npm");
  assert.equal(plan.publish, false);
  assert.equal(plan.commands.some((command) => command.args[0] === "publish"), false);
});

test("createLocalReleasePlan rejects unsupported package managers", async () => {
  const cwd = await createPackage({
    "package.json": JSON.stringify({
      name: "example-package",
      version: "1.0.0",
      packageManager: "pnpm@9.0.0",
    }),
  });

  await assert.rejects(
    () => createLocalReleasePlan(cwd),
    /Unsupported package manager: pnpm@9\.0\.0/
  );
});

test("runLocalRelease dry-run invokes zero command-runner calls", async () => {
  const cwd = await createPackage({
    "package.json": JSON.stringify({
      name: "example-package",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
    }),
  });
  let calls = 0;
  const commandRunner: CommandRunner = async () => {
    calls += 1;
    return { stdout: "", stderr: "" };
  };

  await runLocalRelease({ cwd, dryRun: true, commandRunner, logger: noopLogger });

  assert.equal(calls, 0);
});

test("runLocalRelease logs failed command stdout and stderr", async () => {
  const cwd = await createPackage({
    "package.json": JSON.stringify({
      name: "example-package",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
    }),
  });
  const errors: string[] = [];
  const logger: LocalReleaseLogger = {
    ...noopLogger,
    error: (message) => errors.push(message),
  };
  const commandRunner: CommandRunner = async (command, args) => {
    if (command === "git" && args.join(" ") === "status --porcelain") {
      return { stdout: "", stderr: "" };
    }

    const error = new Error("npm update failed") as Error & {
      stdout: string;
      stderr: string;
    };
    error.stdout = "stdout detail";
    error.stderr = "stderr detail";
    throw error;
  };

  await assert.rejects(
    () => runLocalRelease({ cwd, commandRunner, logger }),
    /npm update failed/
  );

  assert.deepEqual(errors, [
    "Command failed: npm update --package-lock-only",
    "stdout:\nstdout detail",
    "stderr:\nstderr detail",
  ]);
});
