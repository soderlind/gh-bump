import test from "node:test";
import assert from "node:assert/strict";
import { runAgent } from "../src/core/agent.ts";
import { InMemoryRepository } from "./support/in-memory-repository.ts";
import {
  createAlert,
  createConfig,
  createStubLlm,
} from "./support/fixtures.ts";

const PACKAGE_JSON = JSON.stringify(
  { name: "app", version: "1.0.0", dependencies: { lodash: "4.17.19" } },
  null,
  2
);

function fixPlanResponse(content: Record<string, unknown>): string {
  return JSON.stringify({
    files: [{ path: "package.json", content }],
    prTitle: "fix(deps): upgrade lodash to 4.17.21",
    prBody: "Security fix.",
    commitMessage: "fix(deps): upgrade lodash to 4.17.21",
  });
}

const PATCHED = {
  name: "app",
  version: "1.0.0",
  dependencies: { lodash: "4.17.21" },
};

test("runAgent reports success with no artifact when there are no alerts", async () => {
  const gh = new InMemoryRepository();
  const results = await runAgent(
    gh,
    createStubLlm([""]),
    createConfig(),
    "example/repo"
  );

  assert.deepEqual(results.map((r) => r.outcome), ["success"]);
  assert.equal(results[0].artifact, null);
  assert.equal(gh.pullRequests.length, 0);
});

test("runAgent commits the fix plan and returns a remediation artifact", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig(),
    "example/repo"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].outcome, "success");
  assert.equal(results[0].prUrl, "https://github.com/example/repo/pull/1");
  assert.deepEqual(results[0].artifact, {
    repo: "example/repo",
    prNumber: 1,
    prUrl: "https://github.com/example/repo/pull/1",
    prTitle: "fix(deps): upgrade lodash to 4.17.21",
    defaultBranch: "main",
  });

  assert.equal(gh.commits.length, 1);
  assert.deepEqual(
    gh.commits[0].files.map((f) => f.path),
    ["package.json"]
  );
  assert.match(gh.branches[0].name, /^gh-bump\/\d{4}-\d{2}-\d{2}\/package\.json-/);
});

test("runAgent never merges — lifecycle is downstream", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
  });

  await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig({ merge: true, release: true, tag: true }),
    "example/repo"
  );

  assert.deepEqual(gh.mergedPrNumbers, []);
  assert.deepEqual(gh.tags, []);
  assert.deepEqual(gh.releases, []);
});

test("runAgent groups lockfile alerts onto the editable manifest", async () => {
  const gh = new InMemoryRepository({
    alerts: [
      createAlert("package-lock.json", "lodash", { number: 1 }),
      createAlert("package.json", "lodash", { number: 2 }),
    ],
    files: { "package.json": PACKAGE_JSON },
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig(),
    "example/repo"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].alertsProcessed, 2);
});

test("runAgent mutates nothing in dry-run mode", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig({ dryRun: true }),
    "example/repo"
  );

  assert.equal(results[0].outcome, "success");
  assert.equal(results[0].artifact, null);
  assert.deepEqual(gh.branches, []);
  assert.deepEqual(gh.commits, []);
  assert.deepEqual(gh.pullRequests, []);
});

test("runAgent skips unverifiable manifests before the LLM in unattended merge mode", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("Gemfile", "rack", { ecosystem: "bundler" })],
    files: { Gemfile: 'gem "rack", "~> 3.0"' },
  });
  const llm = createStubLlm([new Error("must not be called")]);

  const results = await runAgent(
    gh,
    llm,
    createConfig({ merge: true }),
    "example/repo"
  );

  assert.equal(results[0].outcome, "no-fix");
  assert.match(results[0].message ?? "", /Disable merging/);
  assert.equal(llm.calls.length, 0);
});

test("runAgent keeps the unattended eligibility gate in dry-run mode", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("Gemfile", "rack", { ecosystem: "bundler" })],
    files: { Gemfile: 'gem "rack", "~> 3.0"' },
  });
  const llm = createStubLlm([new Error("must not be called")]);

  const results = await runAgent(
    gh,
    llm,
    createConfig({ dryRun: true, merge: true }),
    "example/repo"
  );

  assert.equal(results[0].outcome, "no-fix");
  assert.equal(llm.calls.length, 0);
});

test("runAgent plans unverifiable manifests when a human reviews the pull request", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("Gemfile", "rack", { ecosystem: "bundler" })],
    files: { Gemfile: 'gem "rack", "~> 3.0"' },
  });
  const llm = createStubLlm([
    JSON.stringify({
      files: [{ path: "Gemfile", content: 'gem "rack", "~> 3.1"' }],
      prTitle: "fix(deps): upgrade rack",
      prBody: "Security fix.",
      commitMessage: "fix(deps): upgrade rack",
    }),
  ]);

  const results = await runAgent(gh, llm, createConfig(), "example/repo");

  assert.equal(results[0].outcome, "success");
  assert.equal(llm.calls.length, 1);
});

test("runAgent classifies an out-of-scope fix plan as no-fix", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
  });

  const results = await runAgent(
    gh,
    createStubLlm([
      JSON.stringify({
        files: [{ path: "src/index.ts", content: "// patched" }],
        prTitle: "fix",
        prBody: "fix",
        commitMessage: "fix",
      }),
    ]),
    createConfig(),
    "example/repo"
  );

  assert.equal(results[0].outcome, "no-fix");
  assert.match(results[0].message ?? "", /outside fetched manifest set/);
  assert.deepEqual(gh.pullRequests, []);
});

test("runAgent classifies an LLM failure as failed", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
  });

  const results = await runAgent(
    gh,
    createStubLlm([new Error("provider unavailable")]),
    createConfig(),
    "example/repo"
  );

  assert.equal(results[0].outcome, "failed");
  assert.equal(results[0].message, "provider unavailable");
});

test("runAgent classifies pull-request creation failure as failed", async () => {
  const gh = new InMemoryRepository({
    alerts: [createAlert("package.json", "lodash")],
    files: { "package.json": PACKAGE_JSON },
    failOnCreatePr: "PR already exists",
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig(),
    "example/repo"
  );

  assert.equal(results[0].outcome, "failed");
  assert.equal(results[0].message, "PR already exists");
});

test("runAgent stops the second group once the LLM call budget is spent", async () => {
  const gh = new InMemoryRepository({
    alerts: [
      createAlert("package.json", "lodash", { number: 1 }),
      createAlert("api/package.json", "axios", { number: 2 }),
    ],
    files: {
      "package.json": PACKAGE_JSON,
      "api/package.json": PACKAGE_JSON,
    },
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig({ maxLlmCalls: 1 }),
    "example/repo"
  );

  assert.deepEqual(
    results.map((r) => r.outcome),
    ["success", "budget-stop"]
  );
  assert.match(results[1].message ?? "", /Max LLM calls reached \(1\)/);
});

test("runAgent honours the alert cap", async () => {
  const gh = new InMemoryRepository({
    alerts: [
      createAlert("package.json", "lodash", { number: 1 }),
      createAlert("api/package.json", "axios", { number: 2 }),
    ],
    files: {
      "package.json": PACKAGE_JSON,
      "api/package.json": PACKAGE_JSON,
    },
  });

  const results = await runAgent(
    gh,
    createStubLlm([fixPlanResponse(PATCHED)]),
    createConfig({ maxAlerts: 1 }),
    "example/repo"
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].alertsProcessed, 1);
});
