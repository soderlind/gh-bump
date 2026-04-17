# gh-bump

AI-powered Dependabot security fix agent. Uses an LLM to analyze your code and fix dependency vulnerabilities — no hardcoded patterns, works with any ecosystem. Runs as a CLI or GitHub Action.

> **Use at your own risk.** Always review generated PRs before merging.

## How it works

1. Fetches open Dependabot alerts via GitHub API
2. Reads your manifest files (package.json, pyproject.toml, go.mod, etc.) through the GitHub Contents API
3. Sends the alert details + file contents to an LLM, which determines the minimal fix
4. Commits the fix via the Git tree/blob API (no clone needed)
5. Creates a PR with an AI-generated description
6. Optionally merges, tags, and creates a release

Because the fix logic is driven by an LLM rather than hardcoded patterns, gh-bump works with **any ecosystem** — npm, pip, Go, Rust, Ruby, PHP, Maven, NuGet, and anything else the LLM understands.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Entrypoint (CLI or GitHub Action)                                │
│  src/cli.ts   — parses flags, resolves env vars                  │
│  src/action.ts — reads Action inputs via @actions/core           │
└──────────────┬───────────────────────────────────────────────────┘
               │  Config
               ▼
┌──────────────────────────────────────────────────────────────────┐
│ Agent Loop  (src/core/agent.ts)                                  │
│  1. Fetch alerts                                                 │
│  2. Group by manifest                                            │
│  3. For each group → call LLM with tools → parse FixPlan         │
│  4. Commit files, create PR, optionally merge/tag/release        │
└────┬───────────────┬─────────────────────┬───────────────────────┘
     │               │                     │
     ▼               ▼                     ▼
┌──────────┐  ┌────────────┐  ┌────────────────────────────────────┐
│ GitHub   │  │ LLM Client │  │ Prompts (src/core/prompts.ts)      │
│ Client   │  │ (llm.ts)   │  │  SYSTEM_PROMPT — agent persona     │
│ (github  │  │  Vercel AI │  │  buildAlertPrompt() — alert detail │
│  .ts)    │  │  SDK       │  └────────────────────────────────────┘
└──────────┘  └────────────┘
```

### Step-by-step Execution

#### 1. Fetch Dependabot Alerts

`GitHubClient.listAlerts()` calls `GET /repos/{owner}/{repo}/dependabot/alerts` with `state=open` and an optional severity filter. It paginates through all results.

```ts
const alerts = await gh.listAlerts(repo, config.severity);
```

#### 2. Group Alerts by Manifest

Alerts are grouped by `dependency.manifest_path` (e.g. `package.json`, `requirements.txt`). Each group becomes one PR — this avoids conflicts from parallel file edits.

```ts
const groups = groupAlertsByManifest(alertsToProcess);
// Map<string, DependabotAlert[]>
// e.g. { "package.json": [alert1, alert2], "backend/requirements.txt": [alert3] }
```

#### 3. Build Prompt + Call LLM

For each manifest group, the agent:

1. **Builds a prompt** with structured alert details (GHSA ID, severity, package name, vulnerable range, patched version, manifest path).
2. **Gives the LLM two tools** so it can explore the repo before proposing a fix:
   - `read_file` — reads any file from the repo via the Contents API.
   - `list_directory` — lists directory entries to discover project structure.
3. **Calls `generateText()`** from the Vercel AI SDK. The SDK handles the tool-use loop automatically — the LLM can call `read_file` / `list_directory` multiple times before producing its final answer.

```ts
const response = await llm.call({
  system: SYSTEM_PROMPT,   // agent persona + JSON output format
  prompt,                  // structured alert details
  tools,                   // { read_file, list_directory }
});
```

The LLM returns a JSON `FixPlan`:

```json
{
  "files": [
    { "path": "package.json", "content": "...full updated content..." }
  ],
  "prTitle": "fix(deps): upgrade lodash to 4.17.21 (CVE-2021-23337)",
  "prBody": "## Security Fix\n\nUpgrades lodash from ...",
  "commitMessage": "fix(deps): upgrade lodash to 4.17.21"
}
```

#### 4. Commit Without Cloning

gh-bump never clones the repo. It uses the Git Data API (tree/blob) to create commits server-side:

```
createBlob()  →  for each file, upload content as a base64 blob
createTree()  →  new tree referencing the blobs + the parent tree
createCommit()→  commit pointing to the new tree
updateRef()   →  fast-forward the branch ref to the new commit
```

This is handled in `GitHubClient.commitFiles()`.

#### 5. Create PR

`GitHubClient.createPR()` opens a pull request from the fix branch into the default branch, using the LLM-generated title and body.

#### 6. Merge / Tag / Release (optional)

If `--merge` (or `--release` / `--tag`, which imply merge):

- **Merge**: `GitHubClient.mergePR()` with the configured method (squash/merge/rebase).
- **Tag**: Extracts a semver version from the PR title and creates a lightweight git tag.
- **Release**: Creates a GitHub release with auto-generated release notes.

### LLM Providers

The LLM layer (`src/core/llm.ts`) is provider-agnostic via the Vercel AI SDK:

| Provider     | Default Model            | API Key                     |
| ------------ | ------------------------ | --------------------------- |
| `github`     | `gpt-4o`                 | `GITHUB_TOKEN` (no extra key) |
| `openai`     | `gpt-4o`                 | `OPENAI_API_KEY` or `AI_API_KEY` |
| `anthropic`  | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` or `AI_API_KEY` |

The `github` provider hits the GitHub Models endpoint (`models.inference.ai.azure.com`) using the same `GITHUB_TOKEN` you already need for the API.

### Key Design Decisions

- **No repo clone.** Everything happens through the GitHub API — file reads, commits, PRs. Fast, no git binary needed.
- **Manifest-only fixes.** Updates version constraints in manifest files but NOT lockfiles. Lockfile regeneration is left to CI or Dependabot.
- **One PR per manifest.** Alerts on the same manifest are batched into a single PR to avoid merge conflicts.
- **Dry-run first.** `--dry-run` shows what the agent would do without creating branches, commits, or PRs.
- **Cost guardrails.** `--max-alerts` (default 10) and `--max-llm-calls` (default 20) cap how much work and spend a single run can do.

### Build System

esbuild bundles the TypeScript source into two ESM entrypoints:

```
src/cli.ts    →  dist/cli.js      (CLI binary)
src/action.ts →  dist/action.js   (GitHub Action)
```

Both bundles include a `createRequire` banner for CJS module compatibility (some dependencies use `require`).

```bash
npm run build         # bundle with esbuild
npm run build:check   # type-check only (tsc --noEmit)
```

## Requirements

- Node.js 20+
- A GitHub token with `repo` + `security_events` scope
- An AI API key (OpenAI or Anthropic)

## CLI Usage

```bash
# Install
npm install -g gh-bump

# Or run directly
npx gh-bump --repo=owner/repo --dry-run
```

### Options

| Option | Description |
|--------|-------------|
| `--repo=OWNER/REPO` | Target repository (required) |
| `--severity=LEVEL` | Minimum severity: `critical`, `high`, `medium`, `low` |
| `--dry-run` | Preview changes without applying them |
| `--merge` | Merge PR after creation |
| `--merge-method=METHOD` | Merge method: `squash` (default), `merge`, `rebase` |
| `--release` | Create GitHub release after merge (implies `--merge`) |
| `--tag` | Create git tag after merge (implies `--merge`) |
| `--provider=PROVIDER` | AI provider: `github` (default), `openai`, `anthropic` |
| `--model=MODEL` | AI model override |
| `--max-alerts=N` | Max alerts to process per run (default: 10) |
| `--max-llm-calls=N` | Max LLM calls per run, cost guardrail (default: 20) |
| `--verbose` | Enable debug output |

### Environment variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub token (required) |
| `AI_API_KEY` | AI provider API key (not needed for `github` provider) |
| `OPENAI_API_KEY` | OpenAI API key (fallback if `AI_API_KEY` not set) |
| `ANTHROPIC_API_KEY` | Anthropic API key (fallback if `AI_API_KEY` not set) |

### Examples

```bash
# Dry-run: see what would be fixed
gh-bump --repo=myorg/myapp --dry-run

# Fix critical alerts and merge
gh-bump --repo=myorg/myapp --severity=critical --merge

# Fix, merge, tag, and release
gh-bump --repo=myorg/myapp --merge --release --tag

# Use GitHub Models (no separate AI key needed)
gh-bump --repo=myorg/myapp --provider=github

# Use Anthropic instead of OpenAI
gh-bump --repo=myorg/myapp --provider=anthropic --model=claude-sonnet-4-20250514
```

## GitHub Action

Use gh-bump as a scheduled GitHub Action to automatically fix Dependabot alerts:

```yaml
name: Fix Dependabot Alerts
on:
  schedule:
    - cron: "0 6 * * 1"  # Every Monday at 06:00 UTC
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write
  security-events: read

jobs:
  fix-alerts:
    runs-on: ubuntu-latest
    steps:
      - name: Fix Dependabot alerts
        uses: soderlind/gh-bump@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          ai-provider: github
          severity: high
          merge: true
```

### Action inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | yes | `${{ github.token }}` | GitHub token |
| `ai-provider` | no | `github` | AI provider: `github`, `openai`, or `anthropic` |
| `ai-api-key` | no | — | API key (not needed for `github` provider) |
| `ai-model` | no | — | Model name override |
| `repo` | no | current repo | Target repository |
| `severity` | no | all | Minimum severity |
| `dry-run` | no | `false` | Preview mode |
| `merge` | no | `false` | Merge PRs after creation |
| `merge-method` | no | `squash` | Merge method |
| `release` | no | `false` | Create release (implies merge) |
| `tag` | no | `false` | Create tag (implies merge) |
| `max-alerts` | no | `10` | Max alerts per run |
| `max-llm-calls` | no | `20` | Cost guardrail |

### Action outputs

| Output | Description |
|--------|-------------|
| `prs-created` | Number of PRs created |
| `alerts-fixed` | Number of alerts processed |
| `pr-urls` | JSON array of PR URLs |
| `summary` | Human-readable summary |

## GitHub Token Permissions

For fine-grained PAT, enable:
- **Dependabot alerts**: Read
- **Contents**: Read and write
- **Pull requests**: Read and write
- **Metadata**: Read

## Source Map

```
src/
├── cli.ts              CLI entrypoint (parseArgs, env resolution)
├── action.ts           GitHub Action entrypoint (@actions/core)
└── core/
    ├── agent.ts        Agent loop (fetch → group → LLM → commit → PR)
    ├── github.ts       GitHubClient (Octokit wrapper)
    ├── llm.ts          Provider-agnostic LLM client (Vercel AI SDK)
    ├── prompts.ts      System prompt + alert prompt builder
    ├── types.ts        Shared TypeScript interfaces
    └── log.ts          Structured logging with CI detection
```

## FAQ

### What ecosystems does it support?

Any ecosystem the LLM understands. It reads your actual manifest files and determines the fix, rather than running ecosystem-specific commands. This means npm, pip, Go, Rust, Ruby, PHP, Java, C#, and more all work without special handling.

### Does it update lockfiles?

No. The agent updates version constraints in manifest files (package.json, pyproject.toml, etc.). Lockfile regeneration should be handled by your CI pipeline or Dependabot.

### How much does the AI cost per run?

Typically $0.01–0.10 per alert, depending on the model and file sizes. Use `--max-llm-calls` as a cost guardrail.

### Can I use it without AI?

No. The LLM is core to how gh-bump works — it replaces all the hardcoded ecosystem detection and fix patterns from v1.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## AI Contribution Attribution

When AI tools contribute to development, proper attribution helps track the evolving role of AI in the development process. Contributions should include an Assisted-by tag:

```
Assisted-by: Claude:claude-opus-4-20250514
```

## License

MIT

---

*Automate the boring stuff. Fix security alerts at scale.*
