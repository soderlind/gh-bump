/**
 * Prompt templates for the gh-bump agent.
 */

import type { DependabotAlert } from "./types.js";

const DIRECT_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

type PackageJson = Record<string, unknown>;

function parsePackageJson(content: string | undefined): PackageJson | null {
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

function hasDirectDependency(packageJson: PackageJson | null, packageName: string): boolean {
  if (!packageJson) return false;
  return DIRECT_DEPENDENCY_SECTIONS.some((sectionName) => {
    const section = packageJson[sectionName];
    return Boolean(
      section &&
        typeof section === "object" &&
        !Array.isArray(section) &&
        Object.prototype.hasOwnProperty.call(section, packageName)
    );
  });
}

export const SYSTEM_PROMPT = `You are a security dependency fix agent. Your job is to fix Dependabot security alerts in GitHub repositories by modifying the minimal set of files needed.

## How you work

1. You receive details about one or more Dependabot security alerts (vulnerable package, severity, affected version range, patched version).
2. You read the manifest files provided (or use tools if available) to understand the dependency setup.
3. You determine the minimal fix — typically updating a version constraint in a manifest file (package.json, pyproject.toml, composer.json, go.mod, Gemfile, Cargo.toml, pom.xml, etc.).
4. You output the fixed file contents.

## Rules

- **Minimal changes only**: Only modify what is needed to resolve the alert. Do not refactor, reformat, or add unrelated changes.
- **Preserve formatting**: Match the existing indentation, trailing newlines, and style of each file.
- **Manifest files only**: Update dependency version constraints in manifest files. Do NOT attempt to regenerate lockfiles (package-lock.json, yarn.lock, etc.) — the CI pipeline or Dependabot will handle that.
- **Respect dependency intent**: If the vulnerable package is already a direct dependency in the manifest, update that existing direct dependency entry. If it is only transitive, do NOT add it to dependencies/devDependencies/optionalDependencies/peerDependencies just to force a version.
- **Never add direct npm dependencies**: For package.json fixes, do not add new entries to dependencies, devDependencies, optionalDependencies, or peerDependencies. You may update versions for packages already present there, and you may add or merge overrides/resolutions as described below.
- **Transitive npm fixes**: For npm package.json files, prefer updating the top-level parent package that brings the vulnerable transitive dependency. If no safe parent update is clear, add or merge an npm "overrides" entry for the vulnerable transitive package and patched version. For Yarn use "resolutions" only when the manifest already indicates Yarn; for pnpm use "pnpm.overrides" only when the manifest already indicates pnpm.
- **Skip unsafe transitive fixes**: If you cannot identify a safe parent update or appropriate package-manager override mechanism, return a skipped fix with a reason instead of adding direct dependencies that the project did not already declare.
- **One fix at a time**: If multiple alerts affect the same file, batch them into a single file change.
- **Be conservative**: If you cannot determine a safe fix, say so and explain why. It is better to skip than to break a build.
- **No code execution**: You cannot run package managers, build tools, or tests. Only read and write file contents.

## Output format

After analyzing the alerts and reading the necessary files, respond with a JSON object:

\`\`\`json
{
  "files": [
    { "path": "package.json", "content": "...full updated file content as an escaped JSON string, never raw multiline text..." }
  ],
  "prTitle": "fix(deps): upgrade lodash to 4.17.21 (CVE-2021-23337)",
  "prBody": "## Security Fix\\n\\nUpgrades lodash from 4.17.19 to 4.17.21 to resolve...\\n\\n### Alerts resolved\\n- GHSA-xxxx: ...",
  "commitMessage": "fix(deps): upgrade lodash to 4.17.21"
}
\`\`\`

If no fix is possible, respond with:
\`\`\`json
{
  "files": [],
  "prTitle": "",
  "prBody": "",
  "commitMessage": "",
  "reason": "Explanation of why no fix could be applied"
}
\`\`\`

For JSON manifests such as package.json, you may return "content" as either an escaped JSON string or as the parsed JSON object. Do not return raw unescaped multiline text inside a JSON string.
`;

/**
 * Build the user prompt with alert details.
 */
export function buildAlertPrompt(
  repo: string,
  alerts: DependabotAlert[],
  prefetchedFiles?: Map<string, string>
): string {
  const alertDetails = alerts
    .map((a, i) => {
      const vuln = a.security_vulnerability;
      const adv = a.security_advisory;
      const patched = vuln.first_patched_version?.identifier ?? "unknown";
      const packageJson = a.dependency.manifest_path.endsWith("package.json")
        ? parsePackageJson(prefetchedFiles?.get(a.dependency.manifest_path))
        : null;
      const isDirectDependency = hasDirectDependency(packageJson, vuln.package.name);
      const dependencyKind = packageJson
        ? isDirectDependency
          ? "direct dependency declared in the manifest"
          : "transitive dependency not declared directly in the manifest"
        : "unknown from provided files";
      const requiredHandling =
        packageJson && !isDirectDependency
          ? "Do not add this package to dependencies/devDependencies; use a parent dependency update or package.json overrides."
          : "Update the existing direct dependency entry if a manifest change is needed.";

      return `### Alert ${i + 1}: ${adv.summary}
- **GHSA**: ${adv.ghsa_id}${adv.cve_id ? ` / ${adv.cve_id}` : ""}
- **Severity**: ${vuln.severity}
- **Package**: ${vuln.package.name} (${vuln.package.ecosystem})
- **Vulnerable range**: ${vuln.vulnerable_version_range}
- **Patched version**: ${patched}
- **Manifest**: ${a.dependency.manifest_path}
- **Scope**: ${a.dependency.scope}
- **Dependency relationship**: ${dependencyKind}
- **Required handling**: ${requiredHandling}`;
    })
    .join("\n\n");

  // Build file contents section if we have pre-fetched files
  let fileContents = "";
  if (prefetchedFiles && prefetchedFiles.size > 0) {
    const sections = Array.from(prefetchedFiles.entries())
      .map(([path, content]) => `#### \`${path}\`\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");
    fileContents = `\n\n## Current file contents\n\n${sections}`;
  }

  const toolHint = prefetchedFiles
    ? "The manifest files are provided below."
    : "Use \`list_directory\` and \`read_file\` tools to read the manifest files.";

  return `Fix the following Dependabot security alert(s) in **${repo}**.

${toolHint}

${alertDetails}${fileContents}

After analysis, respond with the JSON fix plan as described in your instructions.`;
}
