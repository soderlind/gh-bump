/**
 * GitHub API client for gh-bump.
 *
 * Handles: Dependabot alerts, file reads, no-clone commits (tree/blob API),
 * PR creation, merging, releases, and tagging.
 */

import { Octokit } from "@octokit/rest";
import type {
  DependabotAlert,
  DirectoryEntry,
  FileChange,
  MergeMethod,
  Severity,
} from "./types.js";
import * as log from "./log.js";

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  // ── Helpers ────────────────────────────────────────────────────

  private split(nwo: string): { owner: string; repo: string } {
    const [owner, repo] = nwo.split("/");
    if (!owner || !repo) throw new Error(`Invalid repo format: ${nwo}`);
    return { owner, repo };
  }

  // ── Repository info ────────────────────────────────────────────

  async getDefaultBranch(nwo: string): Promise<string> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data.default_branch;
  }

  // ── Dependabot alerts ──────────────────────────────────────────

  async listAlerts(
    nwo: string,
    severity?: Severity
  ): Promise<DependabotAlert[]> {
    const { owner, repo } = this.split(nwo);
    const params: Record<string, string> = { state: "open" };
    if (severity) params.severity = severity;

    const alerts: DependabotAlert[] = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.request(
        "GET /repos/{owner}/{repo}/dependabot/alerts",
        { owner, repo, ...params, per_page: 100, page }
      );

      if (!Array.isArray(data) || data.length === 0) break;
      alerts.push(...(data as DependabotAlert[]));
      if (data.length < 100) break;
      page++;
    }

    return alerts;
  }

  // ── File operations (read-only, via Contents API) ──────────────

  async getFileContent(
    nwo: string,
    path: string,
    ref?: string
  ): Promise<string> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });

    if (Array.isArray(data) || data.type !== "file") {
      throw new Error(`${path} is not a file`);
    }

    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  async listDirectory(
    nwo: string,
    path: string,
    ref?: string
  ): Promise<DirectoryEntry[]> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });

    if (!Array.isArray(data)) {
      throw new Error(`${path} is not a directory`);
    }

    return data.map((entry) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type as DirectoryEntry["type"],
      size: entry.size,
    }));
  }

  // ── Branch management ──────────────────────────────────────────

  async getBranchSha(nwo: string, branch: string): Promise<string> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    return data.object.sha;
  }

  async createBranch(
    nwo: string,
    branch: string,
    fromSha: string
  ): Promise<void> {
    const { owner, repo } = this.split(nwo);
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: fromSha,
    });
    log.debug(`Created branch ${branch} at ${fromSha.slice(0, 7)}`);
  }

  // ── No-clone commit via tree/blob API ──────────────────────────

  async commitFiles(
    nwo: string,
    branch: string,
    files: FileChange[],
    message: string,
    parentSha: string
  ): Promise<string> {
    const { owner, repo } = this.split(nwo);

    // 1. Create blobs for each file
    const treeItems = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await this.octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString("base64"),
          encoding: "base64",
        });
        return {
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    // 2. Get the base tree from the parent commit
    const { data: parentCommit } = await this.octokit.git.getCommit({
      owner,
      repo,
      commit_sha: parentSha,
    });

    // 3. Create new tree
    const { data: tree } = await this.octokit.git.createTree({
      owner,
      repo,
      base_tree: parentCommit.tree.sha,
      tree: treeItems,
    });

    // 4. Create commit
    const { data: commit } = await this.octokit.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.sha,
      parents: [parentSha],
    });

    // 5. Update branch ref to point to new commit
    await this.octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    log.debug(`Committed ${files.length} file(s): ${commit.sha.slice(0, 7)}`);
    return commit.sha;
  }

  // ── Pull requests ──────────────────────────────────────────────

  async createPR(
    nwo: string,
    title: string,
    body: string,
    head: string,
    base: string
  ): Promise<{ number: number; url: string }> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      body,
      head,
      base,
    });
    return { number: data.number, url: data.html_url };
  }

  async mergePR(
    nwo: string,
    prNumber: number,
    method: MergeMethod = "squash"
  ): Promise<boolean> {
    const { owner, repo } = this.split(nwo);
    try {
      await this.octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: method,
      });
      return true;
    } catch (err) {
      log.warn(`Could not merge PR #${prNumber}: ${err}`);
      return false;
    }
  }

  // ── Releases and tags ──────────────────────────────────────────

  async createTag(nwo: string, tag: string, sha: string): Promise<void> {
    const { owner, repo } = this.split(nwo);
    await this.octokit.git.createRef({
      owner,
      repo,
      ref: `refs/tags/${tag}`,
      sha,
    });
    log.debug(`Created tag ${tag}`);
  }

  async createRelease(
    nwo: string,
    tag: string,
    name: string,
    generateNotes: boolean = true
  ): Promise<string> {
    const { owner, repo } = this.split(nwo);
    const { data } = await this.octokit.repos.createRelease({
      owner,
      repo,
      tag_name: tag,
      name,
      generate_release_notes: generateNotes,
    });
    return data.html_url;
  }
}
