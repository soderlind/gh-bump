import test from "node:test";
import assert from "node:assert/strict";
import { runRepositoryLifecycle } from "../src/core/lifecycle.ts";
import { InMemoryRepository } from "./support/in-memory-repository.ts";
import { createConfig } from "./support/fixtures.ts";
import type { AgentResult } from "../src/core/types.ts";

function successResult(prTitle: string): AgentResult {
  return {
    repo: "example/repo",
    alertsProcessed: 1,
    prUrl: "https://github.com/example/repo/pull/1",
    outcome: "success",
    message: null,
    artifact: {
      repo: "example/repo",
      prNumber: 1,
      prUrl: "https://github.com/example/repo/pull/1",
      prTitle,
      defaultBranch: "main",
    },
  };
}

const noFixResult: AgentResult = {
  repo: "example/repo",
  alertsProcessed: 1,
  prUrl: null,
  outcome: "no-fix",
  message: "nothing to do",
  artifact: null,
};

test("runRepositoryLifecycle does nothing when no lifecycle step is requested", async () => {
  const gh = new InMemoryRepository();
  await runRepositoryLifecycle(gh, createConfig(), [successResult("fix 1.2.3")]);

  assert.deepEqual(gh.mergedPrNumbers, []);
});

test("runRepositoryLifecycle does nothing in dry-run mode", async () => {
  const gh = new InMemoryRepository();
  await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, dryRun: true }),
    [successResult("fix 1.2.3")]
  );

  assert.deepEqual(gh.mergedPrNumbers, []);
});

test("runRepositoryLifecycle merges each remediation artifact", async () => {
  const gh = new InMemoryRepository();
  await runRepositoryLifecycle(gh, createConfig({ merge: true }), [
    successResult("fix 1.2.3"),
    noFixResult,
  ]);

  assert.deepEqual(gh.mergedPrNumbers, [1]);
  assert.deepEqual(gh.tags, []);
});

test("runRepositoryLifecycle tags and releases the version from the PR title", async () => {
  const gh = new InMemoryRepository();
  await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, tag: true, release: true }),
    [successResult("fix(deps): upgrade lodash to 4.17.21")]
  );

  assert.deepEqual(
    gh.tags.map((t) => t.tag),
    ["4.17.21"]
  );
  assert.deepEqual(
    gh.releases.map((r) => r.tag),
    ["4.17.21"]
  );
});

test("runRepositoryLifecycle skips tagging when the PR title has no version", async () => {
  const gh = new InMemoryRepository();
  await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, tag: true }),
    [successResult("fix(deps): patch the vulnerable transitive dependency")]
  );

  assert.deepEqual(gh.mergedPrNumbers, [1]);
  assert.deepEqual(gh.tags, []);
});

test("runRepositoryLifecycle stops at a failed merge", async () => {
  const gh = new InMemoryRepository({ mergeSucceeds: false });
  await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, tag: true, release: true }),
    [successResult("fix 4.17.21")]
  );

  assert.deepEqual(gh.tags, []);
  assert.deepEqual(gh.releases, []);
});

test("runRepositoryLifecycle reports a failing step instead of throwing", async () => {
  const gh = new InMemoryRepository({ failOnCreateTag: "tag already exists" });

  const failures = await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, tag: true }),
    [successResult("fix 4.17.21")]
  );

  assert.deepEqual(failures, [
    { repo: "example/repo", prNumber: 1, message: "tag already exists" },
  ]);
  assert.deepEqual(gh.mergedPrNumbers, [1]);
});

test("runRepositoryLifecycle continues to the next artifact after a failure", async () => {
  const gh = new InMemoryRepository({ failOnCreateTag: "tag already exists" });
  const second = successResult("fix 4.17.21");
  second.artifact!.prNumber = 2;

  const failures = await runRepositoryLifecycle(
    gh,
    createConfig({ merge: true, tag: true }),
    [successResult("fix 4.17.21"), second]
  );

  assert.equal(failures.length, 2);
  assert.deepEqual(gh.mergedPrNumbers, [1, 2]);
});
