import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string }
) => Promise<CommandResult>;

export interface LocalReleaseOptions {
  cwd?: string;
  dryRun?: boolean;
  publish?: boolean;
  commandRunner?: CommandRunner;
  logger?: LocalReleaseLogger;
}

export interface LocalReleaseLogger {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  dryRun(message: string): void;
  group(message: string): void;
  groupEnd(): void;
}

export interface LocalReleaseCommand {
  label: string;
  command: string;
  args: string[];
}

export interface LocalReleasePlan {
  cwd: string;
  packageName: string;
  currentVersion: string;
  nextVersion: string;
  packageManager: "npm";
  commands: LocalReleaseCommand[];
  publish: boolean;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
}

const defaultLogger: LocalReleaseLogger = {
  info: (message) => console.log(message),
  success: (message) => console.log(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  dryRun: (message) => console.log(`[DRY-RUN] ${message}`),
  group: (message) => console.log(message),
  groupEnd: () => undefined,
};

interface CommandFailure extends Error {
  stdout?: unknown;
  stderr?: unknown;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function getScripts(packageJson: PackageJson): Record<string, string> {
  if (!packageJson.scripts || typeof packageJson.scripts !== "object") {
    return {};
  }

  return packageJson.scripts as Record<string, string>;
}

function detectPackageManager(
  packageJson: PackageJson,
  hasPackageLock: boolean
): "npm" {
  const packageManager = packageJson.packageManager;

  if (typeof packageManager === "string") {
    if (packageManager.startsWith("npm@")) {
      return "npm";
    }

    throw new Error(
      `Unsupported package manager: ${packageManager}. Local full-run currently supports npm only.`
    );
  }

  if (hasPackageLock) {
    return "npm";
  }

  throw new Error(
    "Could not detect npm package manager. Add package-lock.json or packageManager: npm@... to package.json."
  );
}

function assertPackageString(
  value: unknown,
  field: "name" | "version"
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`package.json must include a ${field} string.`);
  }

  return value;
}

export function getNextPatchVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?(?:\+.+)?$/);
  if (!match) {
    throw new Error(`Unsupported package version: ${version}`);
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  return `${major}.${minor}.${patch + 1}`;
}

export async function createLocalReleasePlan(
  cwd = process.cwd(),
  publish = false
): Promise<LocalReleasePlan> {
  const packageJsonPath = join(cwd, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    throw new Error("package.json not found. Run --full-run from an npm package root.");
  }

  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8")
  ) as PackageJson;
  const hasPackageLock = await pathExists(join(cwd, "package-lock.json"));
  const packageManager = detectPackageManager(packageJson, hasPackageLock);
  const packageName = assertPackageString(packageJson.name, "name");
  const currentVersion = assertPackageString(packageJson.version, "version");
  const nextVersion = getNextPatchVersion(currentVersion);
  const scripts = getScripts(packageJson);

  const commands: LocalReleaseCommand[] = [
    {
      label: "Update package lock",
      command: "npm",
      args: ["update", "--package-lock-only"],
    },
    {
      label: "Bump patch version",
      command: "npm",
      args: ["version", "patch", "--no-git-tag-version"],
    },
  ];

  if (scripts.test) {
    commands.push({ label: "Run tests", command: "npm", args: ["test"] });
  }

  if (scripts["build:check"]) {
    commands.push({
      label: "Run type check",
      command: "npm",
      args: ["run", "build:check"],
    });
  }

  if (scripts.build) {
    commands.push({ label: "Run build", command: "npm", args: ["run", "build"] });
  }

  if (publish) {
    commands.push({ label: "Publish package", command: "npm", args: ["publish"] });
  }

  return {
    cwd,
    packageName,
    currentVersion,
    nextVersion,
    packageManager,
    commands,
    publish,
  };
}

async function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd: string }
): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
  });

  return { stdout, stderr };
}

function formatCommand(command: LocalReleaseCommand): string {
  return [command.command, ...command.args].join(" ");
}

function getOutput(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function logCommandFailure(
  logger: LocalReleaseLogger,
  command: LocalReleaseCommand,
  err: unknown
): void {
  const failure = err as CommandFailure;
  const stdout = getOutput(failure.stdout);
  const stderr = getOutput(failure.stderr);

  logger.error(`Command failed: ${formatCommand(command)}`);
  if (stdout) {
    logger.error(`stdout:\n${stdout}`);
  }
  if (stderr) {
    logger.error(`stderr:\n${stderr}`);
  }
}

async function runCommand(
  logger: LocalReleaseLogger,
  runner: CommandRunner,
  cwd: string,
  command: LocalReleaseCommand
): Promise<CommandResult> {
  logger.info(`${command.label}: ${formatCommand(command)}`);
  try {
    return await runner(command.command, command.args, { cwd });
  } catch (err) {
    logCommandFailure(logger, command, err);
    throw err;
  }
}

async function requireCleanWorktree(
  runner: CommandRunner,
  cwd: string
): Promise<void> {
  const result = await runner("git", ["status", "--porcelain"], { cwd });
  if (result.stdout.trim().length > 0) {
    throw new Error("Git worktree must be clean before running --full-run.");
  }
}

async function verifyNpmAuth(runner: CommandRunner, cwd: string): Promise<void> {
  await runner("npm", ["whoami"], { cwd });
}

function logPlan(
  logger: LocalReleaseLogger,
  plan: LocalReleasePlan,
  dryRun: boolean
): void {
  logger.group("Local full-run plan");
  logger.info(`Package:         ${plan.packageName}`);
  logger.info(`Current version: ${plan.currentVersion}`);
  logger.info(`Next version:    ${plan.nextVersion}`);
  logger.info(`Package manager: ${plan.packageManager}`);
  logger.info(`Publish:         ${plan.publish ? "yes" : "no"}`);

  for (const command of plan.commands) {
    const message = `${command.label}: ${formatCommand(command)}`;
    if (dryRun) {
      logger.dryRun(message);
    } else {
      logger.info(message);
    }
  }

  if (!plan.publish) {
    const message = "Publish skipped. Add --publish to run npm publish.";
    if (dryRun) {
      logger.dryRun(message);
    } else {
      logger.warn(message);
    }
  }

  logger.groupEnd();
}

export async function runLocalRelease(
  options: LocalReleaseOptions = {}
): Promise<LocalReleasePlan> {
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? false;
  const publish = options.publish ?? false;
  const runner = options.commandRunner ?? defaultCommandRunner;
  const logger = options.logger ?? defaultLogger;
  const plan = await createLocalReleasePlan(cwd, publish);

  logPlan(logger, plan, dryRun);

  if (dryRun) {
    return plan;
  }

  logger.group("Check");
  await requireCleanWorktree(runner, cwd);
  logger.success("Git worktree is clean");
  if (publish) {
    await verifyNpmAuth(runner, cwd);
    logger.success("npm authentication verified");
  }
  logger.groupEnd();

  for (const command of plan.commands) {
    await runCommand(logger, runner, cwd, command);
  }

  if (!publish) {
    logger.warn("Publish skipped. Re-run with --publish after reviewing the release changes.");
  }

  return plan;
}
