import type { DependabotAlert } from "./types.js";

/**
 * Map a lockfile path to its corresponding manifest file.
 */
export function resolveManifestFromLockfile(lockfile: string): string | null {
  const dir = lockfile.replace(/[^/]*$/, "");
  const name = lockfile.split("/").pop() ?? "";

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

export function isLockfilePath(path: string): boolean {
  return /lock|yarn\.lock|Gemfile\.lock|Cargo\.lock|composer\.lock|pnpm-lock/i.test(path);
}

export function getEditableManifestPath(path: string): string {
  if (!isLockfilePath(path)) {
    return path;
  }

  return resolveManifestFromLockfile(path) ?? path;
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
