/**
 * Logging utilities for gh-bump.
 * Works in both CLI (colorized) and GitHub Actions (::group:: annotations).
 */

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;

function timestamp(): string {
  return new Date().toISOString();
}

export function info(msg: string): void {
  if (isCI) {
    console.log(msg);
  } else {
    console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
  }
}

export function success(msg: string): void {
  if (isCI) {
    console.log(`✅ ${msg}`);
  } else {
    console.log(`\x1b[32m✔\x1b[0m ${msg}`);
  }
}

export function warn(msg: string): void {
  if (isCI) {
    console.log(`::warning::${msg}`);
  } else {
    console.log(`\x1b[33m⚠\x1b[0m ${msg}`);
  }
}

export function error(msg: string): void {
  if (isCI) {
    console.log(`::error::${msg}`);
  } else {
    console.error(`\x1b[31m✖\x1b[0m ${msg}`);
  }
}

export function debug(msg: string): void {
  if (process.env.VERBOSE === "true") {
    if (isCI) {
      console.log(`::debug::${msg}`);
    } else {
      console.log(`\x1b[90m${timestamp()} ${msg}\x1b[0m`);
    }
  }
}

export function dryRun(msg: string): void {
  if (isCI) {
    console.log(`[DRY-RUN] ${msg}`);
  } else {
    console.log(`\x1b[35m⊘ [DRY-RUN]\x1b[0m ${msg}`);
  }
}

export function group(name: string): void {
  if (isCI) {
    console.log(`::group::${name}`);
  } else {
    console.log(`\n\x1b[1m── ${name} ──\x1b[0m`);
  }
}

export function groupEnd(): void {
  if (isCI) {
    console.log("::endgroup::");
  }
}
