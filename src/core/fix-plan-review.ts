/**
 * Fix Plan admission: decides whether a model response becomes an admitted
 * Fix Plan or a No Fix Produced Outcome.
 *
 * Owns the Fix Plan Scope Boundary in one place — parsing, lockfile and
 * out-of-scope rejection, and the npm direct-dependency rule.
 */

import type { DependabotAlert, FixPlan } from "./types.ts";
import { parseFixPlan } from "./fix-plan.ts";
import {
  directDependencyNames,
  immutablePackageJsonContent,
  isLockfilePath,
  readPackageJson,
} from "./manifest.ts";
import { isDeepStrictEqual } from "node:util";

export type FixPlanReview =
  | { admitted: true; plan: FixPlan }
  | { admitted: false; reason: string; raw?: string };

const DEFAULT_NO_FIX_REASON = "No fix plan from LLM";

function noFix(reason: string, raw?: string): FixPlanReview {
  return { admitted: false, reason, raw };
}

function scopeBoundaryViolation(
  plan: FixPlan,
  fetchedManifests: ReadonlySet<string>
): string | null {
  for (const file of plan.files) {
    if (isLockfilePath(file.path)) {
      return `Fix plan attempts to edit lockfile: ${file.path}`;
    }

    if (!fetchedManifests.has(file.path)) {
      return `Fix plan attempts to edit file outside fetched manifest set: ${file.path}`;
    }
  }

  return null;
}

function npmDirectDependencyViolation(
  plan: FixPlan,
  alerts: DependabotAlert[],
  fetchedManifests: Map<string, string>
): string | null {
  for (const file of plan.files) {
    if (!file.path.endsWith("package.json")) {
      continue;
    }

    const original = readPackageJson(fetchedManifests.get(file.path));
    const proposed = readPackageJson(file.content);
    if (!original || !proposed) {
      continue;
    }

    const hasNpmAlerts = alerts.some(
      (alert) =>
        alert.dependency.manifest_path === file.path &&
        alert.security_vulnerability.package.ecosystem === "npm"
    );
    if (!hasNpmAlerts) {
      continue;
    }

    const originalNames = directDependencyNames(original);
    const additions = [...directDependencyNames(proposed)].filter(
      (name) => !originalNames.has(name)
    );

    if (additions.length > 0) {
      return `Fix plan adds new direct npm package(s): ${additions.join(
        ", "
      )}. Dependency fixes must update existing direct dependencies or use package.json overrides.`;
    }
  }

  return null;
}

function contentBoundaryViolation(
  plan: FixPlan,
  fetchedManifests: Map<string, string>
): string | null {
  for (const file of plan.files) {
    if (!file.path.endsWith("package.json")) {
      continue;
    }

    const original = readPackageJson(fetchedManifests.get(file.path));
    const proposed = readPackageJson(file.content);
    if (!original || !proposed) {
      return `Fix plan contains invalid package.json content: ${file.path}`;
    }

    if (
      !isDeepStrictEqual(
        immutablePackageJsonContent(original),
        immutablePackageJsonContent(proposed)
      )
    ) {
      return `Fix plan changes package.json content outside the dependency allowlist: ${file.path}`;
    }
  }

  return null;
}

export function reviewFixPlan(
  response: string,
  alerts: DependabotAlert[],
  fetchedManifests: Map<string, string>
): FixPlanReview {
  const parsed = parseFixPlan(response);

  if (!parsed.ok) {
    if (parsed.reason) {
      return noFix(parsed.reason);
    }

    return noFix(parsed.error ?? DEFAULT_NO_FIX_REASON, parsed.raw);
  }

  const scopeError = scopeBoundaryViolation(
    parsed.plan,
    new Set(fetchedManifests.keys())
  );
  if (scopeError) {
    return noFix(scopeError);
  }

  const contentError = contentBoundaryViolation(parsed.plan, fetchedManifests);
  if (contentError) {
    return noFix(contentError);
  }

  const npmError = npmDirectDependencyViolation(
    parsed.plan,
    alerts,
    fetchedManifests
  );
  if (npmError) {
    return noFix(npmError);
  }

  return { admitted: true, plan: parsed.plan };
}
