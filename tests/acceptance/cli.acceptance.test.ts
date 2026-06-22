import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const repoRoot = new URL("../../", import.meta.url);
const cliPath = new URL("../../dist/cli.js", import.meta.url);

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], cwd?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath.pathname, ...args], {
      cwd: cwd ?? repoRoot.pathname,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function createTempPackage(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "gh-bump-acceptance-"));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "acceptance-package",
        version: "1.0.0",
        packageManager: "npm@11.0.0",
      },
      null,
      2
    )
  );

  return cwd;
}

test("CLI --help returns usage and exits 0", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /USAGE/);
  assert.match(result.stdout, /gh-bump --repo=owner\/repo/);
});

test("CLI --full-run --dry-run succeeds from npm package root", async () => {
  const cwd = await createTempPackage();
  const result = await runCli(["--full-run", "--dry-run"], cwd);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /DRY-RUN MODE/);
  assert.match(result.stdout, /Local full-run plan/);
  assert.match(result.stdout, /Publish skipped\. Add --publish/);
});

test("CLI rejects --full-run with incompatible remote mode flags", async () => {
  const result = await runCli(["--full-run", "--repo=owner/repo"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /--full-run cannot be combined with: --repo/);
});
