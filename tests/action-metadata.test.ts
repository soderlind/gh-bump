import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const ACTION_YML_PATH = new URL("../action.yml", import.meta.url);

test("action.yml declares outcome-based outputs", async () => {
  const content = await readFile(ACTION_YML_PATH, "utf8");

  assert.match(content, /^\s*no-fix:\s*$/m);
  assert.match(content, /^\s*budget-stops:\s*$/m);
  assert.match(content, /^\s*failed:\s*$/m);
});
