function isLockfileEditPath(path: string): boolean {
  return /lock|yarn\.lock|Gemfile\.lock|Cargo\.lock|composer\.lock|pnpm-lock/i.test(path);
}

export function createBranchName(manifest: string, now = Date.now()): string {
  const safeName = manifest.replace(/[/\\]/g, "-").replace(/\.lock$/, "");
  const date = new Date(now).toISOString().slice(0, 10);
  const suffix = now.toString(36);

  return `gh-bump/${date}/${safeName}-${suffix}`;
}

export function hasLlmCallBudget(callsMade: number, maxCalls: number): boolean {
  return callsMade < maxCalls;
}

export function validatePlanFileScope(
  files: { path: string }[],
  allowedPaths: ReadonlySet<string>
): string | null {
  for (const file of files) {
    if (isLockfileEditPath(file.path)) {
      return `Fix plan attempts to edit lockfile: ${file.path}`;
    }

    if (!allowedPaths.has(file.path)) {
      return `Fix plan attempts to edit file outside fetched manifest set: ${file.path}`;
    }
  }

  return null;
}
