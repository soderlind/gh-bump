/**
 * Ports the remediation and lifecycle modules use to reach a repository.
 *
 * Two adapters exist: GitHubClient (Octokit) in production, an in-memory
 * adapter in tests.
 */

import type {
  DependabotAlert,
  DirectoryEntry,
  FileChange,
  MergeMethod,
  Severity,
} from "./types.ts";

/** Everything Security Remediation needs, up to the remediation pull request. */
export interface RepositoryPort {
  listAlerts(repo: string, severity?: Severity): Promise<DependabotAlert[]>;
  getDefaultBranch(repo: string): Promise<string>;
  getBranchSha(repo: string, branch: string): Promise<string>;
  getFileContent(repo: string, path: string, ref?: string): Promise<string>;
  listDirectory(
    repo: string,
    path: string,
    ref?: string
  ): Promise<DirectoryEntry[]>;
  createBranch(repo: string, branch: string, fromSha: string): Promise<void>;
  commitFiles(
    repo: string,
    branch: string,
    files: FileChange[],
    message: string,
    parentSha: string
  ): Promise<string>;
  createPR(
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }>;
}

/** Everything the downstream repository lifecycle needs, after the pull request. */
export interface LifecyclePort {
  getBranchSha(repo: string, branch: string): Promise<string>;
  mergePR(
    repo: string,
    prNumber: number,
    method?: MergeMethod
  ): Promise<boolean>;
  createTag(repo: string, tag: string, sha: string): Promise<void>;
  createRelease(repo: string, tag: string, name: string): Promise<string>;
}
