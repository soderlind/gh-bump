import type { DependabotAlert } from "./types.ts";

export type PackageJson = Record<string, unknown>;

export const DIRECT_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export const PACKAGE_JSON_MUTABLE_PATHS = [
  ...DIRECT_DEPENDENCY_SECTIONS.map((section) => [section]),
  ["overrides"],
  ["resolutions"],
  ["pnpm", "overrides"],
] as const;

function withoutPath(value: PackageJson, path: readonly string[]): PackageJson {
  const copy = structuredClone(value);
  let parent: PackageJson = copy;
  const ancestors: Array<[PackageJson, string, PackageJson]> = [];

  for (const segment of path.slice(0, -1)) {
    const child = parent[segment];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return copy;
    }
    ancestors.push([parent, segment, child as PackageJson]);
    parent = child as PackageJson;
  }

  delete parent[path.at(-1)!];
  for (const [container, segment, child] of ancestors.reverse()) {
    if (Object.keys(child).length === 0) {
      delete container[segment];
    }
  }
  return copy;
}

export function immutablePackageJsonContent(
  packageJson: PackageJson
): PackageJson {
  return PACKAGE_JSON_MUTABLE_PATHS.reduce(withoutPath, packageJson);
}

export function readPackageJson(
  content: string | undefined
): PackageJson | null {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as PackageJson)
      : null;
  } catch {
    return null;
  }
}

export function dependencySection(
  packageJson: PackageJson | null,
  section: string
): Record<string, string> {
  const value = packageJson?.[section];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, string>;
}

export function directDependencyNames(
  packageJson: PackageJson | null
): Set<string> {
  const names = new Set<string>();

  for (const section of DIRECT_DEPENDENCY_SECTIONS) {
    for (const name of Object.keys(dependencySection(packageJson, section))) {
      names.add(name);
    }
  }

  return names;
}

export function hasDirectDependency(
  packageJson: PackageJson | null,
  packageName: string
): boolean {
  return directDependencyNames(packageJson).has(packageName);
}

/**
 * Map a lockfile path to its corresponding manifest file.
 */
export function resolveManifestFromLockfile(lockfile: string): string | null {
  const dir = lockfile.replace(/[^/]*$/, "");
  const name = basename(lockfile);

  const mapping: Record<string, string> = {
    "package-lock.json": "package.json",
    "yarn.lock": "package.json",
    "pnpm-lock.yaml": "package.json",
    "Gemfile.lock": "Gemfile",
    "Cargo.lock": "Cargo.toml",
    "composer.lock": "composer.json",
    "poetry.lock": "pyproject.toml",
    "Pipfile.lock": "Pipfile",
  };

  const manifest = mapping[name];
  return manifest ? `${dir}${manifest}` : null;
}

function basename(path: string): string {
  return path.split("/").pop() ?? "";
}

/**
 * Matches "lock" only as a delimited segment of the file name, so directories
 * such as blocks/ or unlock/ are not mistaken for lockfiles.
 */
const LOCKFILE_NAME_PATTERN = /(?:^|[^a-z0-9])lock(?:b|file)?(?:[^a-z0-9]|$)/i;

export function isLockfilePath(path: string): boolean {
  return LOCKFILE_NAME_PATTERN.test(basename(path));
}

export function getEditableManifestPath(path: string): string {
  if (!isLockfilePath(path)) {
    return path;
  }

  return resolveManifestFromLockfile(path) ?? path;
}

export function isVerifiableManifestPath(path: string): boolean {
  return basename(path) === "package.json";
}

function withEditableManifest(alert: DependabotAlert): DependabotAlert {
  const editableManifest = getEditableManifestPath(alert.dependency.manifest_path);
  if (editableManifest === alert.dependency.manifest_path) {
    return alert;
  }

  return {
    ...alert,
    dependency: {
      ...alert.dependency,
      manifest_path: editableManifest,
    },
  };
}

/**
 * Group alerts by editable manifest file so we make one PR per manifest.
 */
export function groupAlertsByManifest(
  alerts: DependabotAlert[]
): Map<string, DependabotAlert[]> {
  const groups = new Map<string, DependabotAlert[]>();
  for (const alert of alerts) {
    const editableAlert = withEditableManifest(alert);
    const key = editableAlert.dependency.manifest_path;
    const group = groups.get(key) ?? [];
    group.push(editableAlert);
    groups.set(key, group);
  }
  return groups;
}
