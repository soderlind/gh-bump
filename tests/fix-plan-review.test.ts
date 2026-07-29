import test from "node:test";
import assert from "node:assert/strict";
import { reviewFixPlan } from "../src/core/fix-plan-review.ts";
import { createAlert } from "./support/fixtures.ts";

const ORIGINAL = JSON.stringify(
  {
    name: "app",
    version: "1.0.0",
    dependencies: { lodash: "4.17.19" },
    devDependencies: { typescript: "6.0.3" },
    optionalDependencies: { fsevents: "2.3.2" },
    peerDependencies: { react: "19.1.0" },
  },
  null,
  2
);

const manifests = new Map([["package.json", ORIGINAL]]);
const alerts = [createAlert("package.json", "lodash")];

function response(plan: Record<string, unknown>): string {
  return JSON.stringify(plan);
}

test("reviewFixPlan admits an in-scope manifest update", () => {
  const review = reviewFixPlan(
    response({
      files: [
        {
          path: "package.json",
          content: { name: "app", version: "1.0.0", dependencies: { lodash: "4.17.21" } },
        },
      ],
      prTitle: "fix(deps): lodash 4.17.21",
      prBody: "body",
      commitMessage: "fix(deps): lodash 4.17.21",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, true);
  assert.ok(review.admitted && review.plan.files[0].path === "package.json");
});

test("reviewFixPlan rejects lockfile edits", () => {
  const review = reviewFixPlan(
    response({
      files: [{ path: "package-lock.json", content: "{}" }],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.match(
    review.admitted ? "" : review.reason,
    /attempts to edit lockfile: package-lock\.json/
  );
});

test("reviewFixPlan rejects edits outside the fetched manifest set", () => {
  const review = reviewFixPlan(
    response({
      files: [{ path: "src/index.ts", content: "// x" }],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.match(
    review.admitted ? "" : review.reason,
    /outside fetched manifest set: src\/index\.ts/
  );
});

test("reviewFixPlan rejects new direct npm dependencies", () => {
  const review = reviewFixPlan(
    response({
      files: [
        {
          path: "package.json",
          content: {
            name: "app",
            version: "1.0.0",
            dependencies: { lodash: "4.17.19", "left-pad": "1.3.0" },
          },
        },
      ],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.match(
    review.admitted ? "" : review.reason,
    /adds new direct npm package\(s\): left-pad/
  );
});

test("reviewFixPlan allows overrides for transitive fixes", () => {
  const review = reviewFixPlan(
    response({
      files: [
        {
          path: "package.json",
          content: {
            name: "app",
            version: "1.0.0",
            dependencies: { lodash: "4.17.19" },
            overrides: { undici: "6.27.0" },
          },
        },
      ],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, true);
});

test("reviewFixPlan rejects package.json changes outside the content boundary", () => {
  const review = reviewFixPlan(
    response({
      files: [
        {
          path: "package.json",
          content: {
            name: "app",
            version: "1.0.0",
            scripts: { postinstall: "node payload.js" },
            dependencies: { lodash: "4.17.21" },
          },
        },
      ],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.match(
    review.admitted ? "" : review.reason,
    /outside the dependency allowlist/
  );
});

for (const [label, change] of [
  ["dependencies", { dependencies: { lodash: "4.17.21" } }],
  ["devDependencies", { devDependencies: { typescript: "6.0.4" } }],
  ["optionalDependencies", { optionalDependencies: { fsevents: "2.3.3" } }],
  ["peerDependencies", { peerDependencies: { react: "19.2.0" } }],
  ["overrides", { overrides: { undici: "6.27.0" } }],
  ["resolutions", { resolutions: { undici: "6.27.0" } }],
  ["pnpm.overrides", { pnpm: { overrides: { undici: "6.27.0" } } }],
] as const) {
  test(`reviewFixPlan permits changes to ${label}`, () => {
    const review = reviewFixPlan(
      response({
        files: [
          {
            path: "package.json",
            content: {
              name: "app",
              version: "1.0.0",
              dependencies: { lodash: "4.17.19" },
              devDependencies: { typescript: "6.0.3" },
              optionalDependencies: { fsevents: "2.3.2" },
              peerDependencies: { react: "19.1.0" },
              ...change,
            },
          },
        ],
        prTitle: "t",
        prBody: "b",
        commitMessage: "c",
      }),
      alerts,
      manifests
    );

    assert.equal(review.admitted, true);
  });
}

for (const [label, change] of [
  ["scripts", { scripts: { postinstall: "node payload.js" } }],
  ["pnpm.patchedDependencies", { pnpm: { patchedDependencies: { x: "x.patch" } } }],
  ["pnpm.onlyBuiltDependencies", { pnpm: { onlyBuiltDependencies: ["x"] } }],
  ["name", { name: "renamed" }],
] as const) {
  test(`reviewFixPlan rejects changes to ${label}`, () => {
    const review = reviewFixPlan(
      response({
        files: [
          {
            path: "package.json",
            content: {
              name: "app",
              version: "1.0.0",
              dependencies: { lodash: "4.17.19" },
              devDependencies: { typescript: "6.0.3" },
              optionalDependencies: { fsevents: "2.3.2" },
              peerDependencies: { react: "19.1.0" },
              ...change,
            },
          },
        ],
        prTitle: "t",
        prBody: "b",
        commitMessage: "c",
      }),
      alerts,
      manifests
    );

    assert.equal(review.admitted, false);
    assert.match(
      review.admitted ? "" : review.reason,
      /outside the dependency allowlist/
    );
  });
}

test("reviewFixPlan rejects malformed proposed package.json content", () => {
  const review = reviewFixPlan(
    response({
      files: [{ path: "package.json", content: "{not json" }],
      prTitle: "t",
      prBody: "b",
      commitMessage: "c",
    }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.match(review.admitted ? "" : review.reason, /invalid package\.json/);
});

test("reviewFixPlan reports the model's skip reason", () => {
  const review = reviewFixPlan(
    response({ files: [], reason: "No safe parent update available" }),
    alerts,
    manifests
  );

  assert.equal(review.admitted, false);
  assert.equal(
    review.admitted ? "" : review.reason,
    "No safe parent update available"
  );
});

test("reviewFixPlan keeps the raw response when parsing fails", () => {
  const review = reviewFixPlan("not json at all", alerts, manifests);

  assert.equal(review.admitted, false);
  assert.equal(review.admitted ? "" : review.raw, "not json at all");
});
