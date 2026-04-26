import type { DependabotAlert, FixPlan } from "./types.js";

const DIRECT_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageJson = Record<string, unknown>;

function parsePackageJson(content: string): PackageJson | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PackageJson)
      : null;
  } catch {
    return null;
  }
}

function directDependencyNames(packageJson: PackageJson): Set<string> {
  const names = new Set<string>();

  for (const sectionName of DIRECT_DEPENDENCY_SECTIONS) {
    const section = packageJson[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      continue;
    }

    for (const packageName of Object.keys(section)) {
      names.add(packageName);
    }
  }

  return names;
}

export function validateFixPlan(
  plan: FixPlan,
  alerts: DependabotAlert[],
  originalFiles: Map<string, string>
): string | null {
  for (const file of plan.files) {
    if (!file.path.endsWith("package.json")) {
      continue;
    }

    const originalContent = originalFiles.get(file.path);
    if (!originalContent) {
      continue;
    }

    const originalPackageJson = parsePackageJson(originalContent);
    const proposedPackageJson = parsePackageJson(file.content);
    if (!originalPackageJson || !proposedPackageJson) {
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

    const originalDirectDependencies = directDependencyNames(originalPackageJson);
    const unsafeAdditions = [...directDependencyNames(proposedPackageJson)].filter(
      (packageName) => !originalDirectDependencies.has(packageName)
    );

    if (unsafeAdditions.length > 0) {
      return `Fix plan adds new direct npm package(s): ${unsafeAdditions.join(
        ", "
      )}. Dependency fixes must update existing direct dependencies or use package.json overrides.`;
    }
  }

  return null;
}
