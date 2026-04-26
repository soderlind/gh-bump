import test from "node:test";
import assert from "node:assert/strict";
import { parseFixPlan } from "../src/core/fix-plan.ts";

test("parseFixPlan accepts fenced JSON and applies defaults", () => {
  const result = parseFixPlan(`\`\`\`json
{
  "files": [
    { "path": "package.json", "content": "{}\\n" }
  ]
}
\`\`\``);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.files, [{ path: "package.json", content: "{}\n" }]);
  assert.equal(result.plan.prTitle, "fix(deps): security dependency update");
  assert.equal(result.plan.prBody, "Automated security fix by gh-bump.");
  assert.equal(result.plan.commitMessage, "fix(deps): security dependency update");
});

test("parseFixPlan returns a skipped result with reason", () => {
  const result = parseFixPlan(JSON.stringify({
    files: [],
    prTitle: "",
    prBody: "",
    commitMessage: "",
    reason: "No patched version exists",
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, "No patched version exists");
});

test("parseFixPlan returns parse errors without throwing", () => {
  const result = parseFixPlan("not json");

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Unexpected token|not valid JSON/);
});

test("parseFixPlan serializes object file content", () => {
  const result = parseFixPlan(JSON.stringify({
    files: [
      {
        path: "package.json",
        content: {
          name: "example",
          overrides: {
            lodash: "4.18.0",
          },
        },
      },
    ],
  }));

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.files, [
    {
      path: "package.json",
      content: '{\n  "name": "example",\n  "overrides": {\n    "lodash": "4.18.0"\n  }\n}\n',
    },
  ]);
});

test("parseFixPlan accepts an opening fence without a closing fence", () => {
  const result = parseFixPlan(`\`\`\`json
{
  "files": [
    { "path": "package.json", "content": "{}\\n" }
  ]
}`);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.files, [{ path: "package.json", content: "{}\n" }]);
});

test("parseFixPlan repairs a single raw multiline content string", () => {
  const result = parseFixPlan(`\`\`\`json
{
  "files": [
    {
      "path": "package.json",
      "content": "{
  "name": "example",
  "overrides": {
    "lodash": "4.18.0"
  }
}"
    }
  ],
  "prTitle": "fix deps",
  "prBody": "body",
  "commitMessage": "commit"
}
\`\`\``);

  assert.equal(result.ok, true);
  assert.deepEqual(result.plan.files, [
    {
      path: "package.json",
      content: '{\n  "name": "example",\n  "overrides": {\n    "lodash": "4.18.0"\n  }\n}',
    },
  ]);
  assert.equal(result.plan.prTitle, "fix deps");
  assert.equal(result.plan.prBody, "body");
  assert.equal(result.plan.commitMessage, "commit");
});

test("parseFixPlan repairs an extra root brace before commitMessage", () => {
  const result = parseFixPlan(`\`\`\`json
{
  "files": [
    {
      "path": "package.json",
      "content": {
        "name": "example",
        "overrides": {
          "lodash": "4.18.0"
        }
      }
    }
  ],
  "prTitle": "fix deps",
  "prBody": "body"
  },
  "commitMessage": "commit"
}
\`\`\``);

  assert.equal(result.ok, true);
  assert.equal(result.plan.prTitle, "fix deps");
  assert.equal(result.plan.prBody, "body");
  assert.equal(result.plan.commitMessage, "commit");
  assert.deepEqual(result.plan.files, [
    {
      path: "package.json",
      content: '{\n  "name": "example",\n  "overrides": {\n    "lodash": "4.18.0"\n  }\n}\n',
    },
  ]);
});
