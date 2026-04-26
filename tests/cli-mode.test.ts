import test from "node:test";
import assert from "node:assert/strict";
import { findFullRunIncompatibleOptions } from "../src/core/cli-mode.ts";

test("findFullRunIncompatibleOptions rejects remote-mode options", () => {
  assert.deepEqual(
    findFullRunIncompatibleOptions([
      "full-run",
      "dry-run",
      "repo",
      "merge",
      "provider",
      "publish",
    ]),
    ["repo", "merge", "provider"]
  );
});

test("findFullRunIncompatibleOptions allows local-mode options", () => {
  assert.deepEqual(
    findFullRunIncompatibleOptions(["full-run", "dry-run", "publish", "verbose"]),
    []
  );
});
