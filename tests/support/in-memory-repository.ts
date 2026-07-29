import type { LifecyclePort, RepositoryPort } from "../../src/core/repository.ts";
import type {
  DependabotAlert,
  DirectoryEntry,
  FileChange,
  MergeMethod,
  Severity,
} from "../../src/core/types.ts";

export interface CreatedPr {
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  number: number;
  url: string;
}

export interface CommittedFiles {
  branch: string;
  files: FileChange[];
  message: string;
}

export interface InMemoryRepositoryOptions {
  alerts?: DependabotAlert[];
  files?: Record<string, string>;
  defaultBranch?: string;
  failOnCreatePr?: string;
  failOnCreateTag?: string;
  mergeSucceeds?: boolean;
}

/**
 * In-memory adapter for RepositoryPort / LifecyclePort — the test-side twin of
 * GitHubClient.
 */
export class InMemoryRepository implements RepositoryPort, LifecyclePort {
  readonly branches: { name: string; fromSha: string }[] = [];
  readonly commits: CommittedFiles[] = [];
  readonly pullRequests: CreatedPr[] = [];
  readonly mergedPrNumbers: number[] = [];
  readonly tags: { tag: string; sha: string }[] = [];
  readonly releases: { tag: string; name: string }[] = [];

  private readonly alerts: DependabotAlert[];
  private readonly files: Record<string, string>;
  private readonly defaultBranchName: string;
  private readonly failOnCreatePr?: string;
  private readonly failOnCreateTag?: string;
  private readonly mergeSucceeds: boolean;
  private nextPrNumber = 1;

  constructor(options: InMemoryRepositoryOptions = {}) {
    this.alerts = options.alerts ?? [];
    this.files = options.files ?? {};
    this.defaultBranchName = options.defaultBranch ?? "main";
    this.failOnCreatePr = options.failOnCreatePr;
    this.failOnCreateTag = options.failOnCreateTag;
    this.mergeSucceeds = options.mergeSucceeds ?? true;
  }

  async listAlerts(
    _repo: string,
    severity?: Severity
  ): Promise<DependabotAlert[]> {
    if (!severity) return this.alerts;
    return this.alerts.filter(
      (alert) => alert.security_vulnerability.severity === severity
    );
  }

  async getDefaultBranch(): Promise<string> {
    return this.defaultBranchName;
  }

  async getBranchSha(): Promise<string> {
    return "basesha0000000000000000000000000000000";
  }

  async getFileContent(_repo: string, path: string): Promise<string> {
    const content = this.files[path];
    if (content === undefined) {
      throw new Error(`${path} not found`);
    }
    return content;
  }

  async listDirectory(): Promise<DirectoryEntry[]> {
    return Object.keys(this.files).map((path) => ({
      name: path,
      path,
      type: "file" as const,
    }));
  }

  async createBranch(
    _repo: string,
    branch: string,
    fromSha: string
  ): Promise<void> {
    this.branches.push({ name: branch, fromSha });
  }

  async commitFiles(
    _repo: string,
    branch: string,
    files: FileChange[],
    message: string
  ): Promise<string> {
    this.commits.push({ branch, files, message });
    return `commit${this.commits.length}`;
  }

  async createPR(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }> {
    if (this.failOnCreatePr) {
      throw new Error(this.failOnCreatePr);
    }

    const number = this.nextPrNumber++;
    const pr = {
      repo,
      title,
      body,
      head,
      base,
      number,
      url: `https://github.com/${repo}/pull/${number}`,
    };
    this.pullRequests.push(pr);
    return { number, url: pr.url };
  }

  async mergePR(
    _repo: string,
    prNumber: number,
    _method?: MergeMethod
  ): Promise<boolean> {
    if (!this.mergeSucceeds) return false;
    this.mergedPrNumbers.push(prNumber);
    return true;
  }

  async createTag(_repo: string, tag: string, sha: string): Promise<void> {
    if (this.failOnCreateTag) {
      throw new Error(this.failOnCreateTag);
    }

    this.tags.push({ tag, sha });
  }

  async createRelease(
    _repo: string,
    tag: string,
    name: string
  ): Promise<string> {
    this.releases.push({ tag, name });
    return `https://github.com/releases/${tag}`;
  }
}
