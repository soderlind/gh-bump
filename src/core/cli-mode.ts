const FULL_RUN_INCOMPATIBLE_OPTIONS = new Set([
  "repo",
  "severity",
  "merge",
  "merge-method",
  "release",
  "tag",
  "provider",
  "model",
  "max-alerts",
  "max-llm-calls",
]);

export function findFullRunIncompatibleOptions(
  optionNames: Iterable<string>
): string[] {
  return [...new Set(optionNames)].filter((name) =>
    FULL_RUN_INCOMPATIBLE_OPTIONS.has(name)
  );
}
