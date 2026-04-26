import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/core/config.ts";

test("normalizeConfig applies shared defaults and github token fallback", () => {
  const config = normalizeConfig({
    githubToken: "gh-token",
    repo: "owner/repo",
  });

  assert.equal(config.aiProvider, "github");
  assert.equal(config.aiApiKey, "gh-token");
  assert.equal(config.merge, false);
  assert.equal(config.mergeMethod, "squash");
  assert.equal(config.maxAlerts, 10);
  assert.equal(config.maxLlmCalls, 20);
});

test("normalizeConfig lets release and tag imply merge", () => {
  const config = normalizeConfig({
    githubToken: "gh-token",
    repo: "owner/repo",
    release: true,
    tag: true,
  });

  assert.equal(config.merge, true);
  assert.equal(config.release, true);
  assert.equal(config.tag, true);
});

test("normalizeConfig validates option values", () => {
  assert.throws(
    () =>
      normalizeConfig({
        githubToken: "gh-token",
        repo: "owner/repo",
        aiProvider: "unknown",
      }),
    /Unsupported AI provider/
  );

  assert.throws(
    () =>
      normalizeConfig({
        githubToken: "gh-token",
        repo: "owner/repo",
        maxAlerts: "0",
      }),
    /maxAlerts must be a positive integer/
  );
});

test("normalizeConfig resolves provider-specific API keys", () => {
  const config = normalizeConfig({
    githubToken: "gh-token",
    repo: "owner/repo",
    aiProvider: "anthropic",
    anthropicApiKey: "anthropic-token",
  });

  assert.equal(config.aiApiKey, "anthropic-token");
});
