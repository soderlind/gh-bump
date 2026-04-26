import test from "node:test";
import assert from "node:assert/strict";
import { formatFixPlanSummary, summarizeFixPlan } from "../src/core/fix-plan-summary.ts";
import type { FixPlan } from "../src/core/types.ts";

test("summarizeFixPlan reports changed devDependencies with versions", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          devDependencies: {
            vite: "^7.3.2",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const summaries = summarizeFixPlan(
    plan,
    new Map([
      [
        "package.json",
        JSON.stringify({
          devDependencies: {
            vite: "^5.4.19",
          },
        }),
      ],
    ])
  );

  assert.deepEqual(summaries, [
    {
      path: "package.json",
      changedDependencies: [],
      changedDevDependencies: [
        { name: "vite", from: "^5.4.19", to: "^7.3.2" },
      ],
      addedOverrides: [],
      changedOverrides: [],
      addedDirectDependencies: [],
    },
  ]);
});

test("summarizeFixPlan reports changed dependencies with versions", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            axios: "^1.15.0",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const summaries = summarizeFixPlan(
    plan,
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: {
            axios: "^1.12.0",
          },
        }),
      ],
    ])
  );

  assert.deepEqual(summaries, [
    {
      path: "package.json",
      changedDependencies: [
        { name: "axios", from: "^1.12.0", to: "^1.15.0" },
      ],
      changedDevDependencies: [],
      addedOverrides: [],
      changedOverrides: [],
      addedDirectDependencies: [],
    },
  ]);
});

test("summarizeFixPlan reports added and changed overrides", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          overrides: {
            axios: "1.15.0",
            lodash: "4.18.0",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const summaries = summarizeFixPlan(
    plan,
    new Map([
      [
        "package.json",
        JSON.stringify({
          overrides: {
            lodash: "4.17.21",
          },
        }),
      ],
    ])
  );

  assert.deepEqual(summaries, [
    {
      path: "package.json",
      changedDependencies: [],
      changedDevDependencies: [],
      addedOverrides: [{ name: "axios", to: "1.15.0" }],
      changedOverrides: [{ name: "lodash", from: "4.17.21", to: "4.18.0" }],
      addedDirectDependencies: [],
    },
  ]);
});

test("summarizeFixPlan reports new direct dependencies", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            app: "^1.0.0",
            lodash: "^4.18.0",
          },
          devDependencies: {
            vite: "^7.3.2",
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const summaries = summarizeFixPlan(
    plan,
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

  assert.deepEqual(summaries, [
    {
      path: "package.json",
      changedDependencies: [],
      changedDevDependencies: [],
      addedOverrides: [],
      changedOverrides: [],
      addedDirectDependencies: [
        { section: "dependencies", name: "lodash", to: "^4.18.0" },
        { section: "devDependencies", name: "vite", to: "^7.3.2" },
      ],
    },
  ]);
});

test("formatFixPlanSummary renders dependency and override changes", () => {
  const lines = formatFixPlanSummary([
    {
      path: "package.json",
      changedDependencies: [],
      changedDevDependencies: [
        { name: "vite", from: "^5.4.19", to: "^7.3.2" },
      ],
      addedOverrides: [{ name: "axios", to: "1.15.0" }],
      changedOverrides: [{ name: "lodash", from: "4.17.21", to: "4.18.0" }],
      addedDirectDependencies: [
        { section: "dependencies", name: "left-pad", to: "^1.3.0" },
      ],
    },
  ]);

  assert.deepEqual(lines, [
    "package.json: devDependencies changed: vite ^5.4.19 -> ^7.3.2",
    "package.json: overrides added: axios 1.15.0",
    "package.json: overrides changed: lodash 4.17.21 -> 4.18.0",
    "package.json: new direct dependencies: left-pad ^1.3.0",
  ]);
});

test("formatFixPlanSummary renders nested override values as JSON", () => {
  const plan: FixPlan = {
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          overrides: {
            minimatch: { "3": "3.1.3" },
          },
        }),
      },
    ],
    prTitle: "fix deps",
    prBody: "",
    commitMessage: "fix deps",
  };

  const lines = formatFixPlanSummary(
    summarizeFixPlan(plan, new Map([["package.json", JSON.stringify({})]]))
  );

  assert.deepEqual(lines, [
    'package.json: overrides added: minimatch {"3":"3.1.3"}',
  ]);
});
