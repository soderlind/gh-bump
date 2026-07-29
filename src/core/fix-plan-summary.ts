import type { FixPlan } from "./types.ts";
import {
  DIRECT_DEPENDENCY_SECTIONS,
  dependencySection,
  readPackageJson,
  type PackageJson,
} from "./manifest.ts";

export interface DependencyVersionChange {
  name: string;
  from: string;
  to: string;
}

export interface DependencyAddition {
  name: string;
  to: string;
}

export interface DirectDependencyAddition extends DependencyAddition {
  section: string;
}

export interface FixPlanFileSummary {
  path: string;
  changedDependencies: DependencyVersionChange[];
  changedDevDependencies: DependencyVersionChange[];
  addedOverrides: DependencyAddition[];
  changedOverrides: DependencyVersionChange[];
  addedDirectDependencies: DirectDependencyAddition[];
}

function formatDependencyValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function changedDependencies(
  originalPackageJson: PackageJson | null,
  proposedPackageJson: PackageJson | null,
  section: string
): DependencyVersionChange[] {
  const original = dependencySection(originalPackageJson, section);
  const proposed = dependencySection(proposedPackageJson, section);

  return Object.keys(proposed)
    .filter((name) => Object.prototype.hasOwnProperty.call(original, name))
    .filter((name) => formatDependencyValue(original[name]) !== formatDependencyValue(proposed[name]))
    .sort()
    .map((name) => ({
      name,
      from: formatDependencyValue(original[name]),
      to: formatDependencyValue(proposed[name]),
    }));
}

function addedDependencies(
  originalPackageJson: PackageJson | null,
  proposedPackageJson: PackageJson | null,
  section: string
): DependencyAddition[] {
  const original = dependencySection(originalPackageJson, section);
  const proposed = dependencySection(proposedPackageJson, section);

  return Object.keys(proposed)
    .filter((name) => !Object.prototype.hasOwnProperty.call(original, name))
    .sort()
    .map((name) => ({ name, to: formatDependencyValue(proposed[name]) }));
}

function addedDirectDependencies(
  originalPackageJson: PackageJson | null,
  proposedPackageJson: PackageJson | null
): DirectDependencyAddition[] {
  return DIRECT_DEPENDENCY_SECTIONS.flatMap((section) =>
    addedDependencies(originalPackageJson, proposedPackageJson, section).map(
      (dependency) => ({ section, ...dependency })
    )
  );
}

export function summarizeFixPlan(
  plan: FixPlan,
  originalFiles: Map<string, string>
): FixPlanFileSummary[] {
  return plan.files.map((file) => {
    const originalPackageJson = readPackageJson(originalFiles.get(file.path));
    const proposedPackageJson = readPackageJson(file.content);

    return {
      path: file.path,
      changedDependencies: changedDependencies(
        originalPackageJson,
        proposedPackageJson,
        "dependencies"
      ),
      changedDevDependencies: changedDependencies(
        originalPackageJson,
        proposedPackageJson,
        "devDependencies"
      ),
      addedOverrides: addedDependencies(
        originalPackageJson,
        proposedPackageJson,
        "overrides"
      ),
      changedOverrides: changedDependencies(
        originalPackageJson,
        proposedPackageJson,
        "overrides"
      ),
      addedDirectDependencies: addedDirectDependencies(
        originalPackageJson,
        proposedPackageJson
      ),
    };
  });
}

function formatVersionChange(change: DependencyVersionChange): string {
  return `${change.name} ${change.from} -> ${change.to}`;
}

function formatAddition(addition: DependencyAddition): string {
  return `${addition.name} ${addition.to}`;
}

export function formatFixPlanSummary(summaries: FixPlanFileSummary[]): string[] {
  return summaries.flatMap((summary) => {
    const lines: string[] = [];

    if (summary.changedDependencies.length > 0) {
      lines.push(
        `${summary.path}: dependencies changed: ${summary.changedDependencies
          .map(formatVersionChange)
          .join(", ")}`
      );
    }

    if (summary.changedDevDependencies.length > 0) {
      lines.push(
        `${summary.path}: devDependencies changed: ${summary.changedDevDependencies
          .map(formatVersionChange)
          .join(", ")}`
      );
    }

    if (summary.addedOverrides.length > 0) {
      lines.push(
        `${summary.path}: overrides added: ${summary.addedOverrides
          .map(formatAddition)
          .join(", ")}`
      );
    }

    if (summary.changedOverrides.length > 0) {
      lines.push(
        `${summary.path}: overrides changed: ${summary.changedOverrides
          .map(formatVersionChange)
          .join(", ")}`
      );
    }

    if (summary.addedDirectDependencies.length > 0) {
      lines.push(
        `${summary.path}: new direct dependencies: ${summary.addedDirectDependencies
          .map(formatAddition)
          .join(", ")}`
      );
    }

    return lines;
  });
}
