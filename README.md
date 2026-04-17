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

## Architecture

```
src/
  cli.ts              # CLI entrypoint
  action.ts           # GitHub Action entrypoint
  core/
    agent.ts          # LLM orchestration loop
    github.ts         # GitHub API client (alerts, files, commits, PRs)
    llm.ts            # Provider-agnostic LLM wrapper (Vercel AI SDK)
    prompts.ts        # System/user prompt templates
    types.ts          # Shared types
    log.ts            # Logging utilities
action.yml            # GitHub Action metadata
```

Key design decisions:
- **No git clone**: All file reads and writes via GitHub API (Contents + tree/blob). Fast, no git binary needed.
- **LLM-driven fixes**: No hardcoded ecosystem patterns. The LLM reads manifests and determines the minimal change.
- **Manifest-only changes**: The agent updates version constraints in manifest files. Lockfile regeneration is left to CI or Dependabot.
- **Provider-agnostic**: Supports OpenAI and Anthropic via the Vercel AI SDK. Easy to add more providers.

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
