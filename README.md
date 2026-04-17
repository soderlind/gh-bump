# gh-bump

Batch Dependabot fix automation tool. Discovers repos with Dependabot security alerts, applies fixes using ecosystem-native tools, creates PRs, and optionally auto-merges after CI passes.

## Features

- **Multi-repo discovery**: Find all repos with open Dependabot alerts across personal and org repos
- **Pattern filtering**: Target specific repos using glob patterns (e.g., `myorg/api-*`)
- **Ecosystem-aware fixes**: Automatically runs `npm audit fix`, `pip-audit`, `cargo update`, etc.
- **Safe PR workflow**: Creates PRs, waits for CI, checks mergeability before merge
- **Dry-run mode**: Preview all actions without making changes
- **State tracking**: Resume interrupted runs, skip already-processed repos
- **Rollback support**: Auto-generates rollback script for reverting changes

## Requirements

- [GitHub CLI](https://cli.github.com/) (`gh`) - authenticated
- [jq](https://stedolan.github.io/jq/) - JSON processing
- Bash 4.0+

```bash
# macOS
brew install gh jq

# Authenticate
gh auth login
```

## Installation

```bash
# Clone the repo
git clone https://github.com/soderlind/gh-bump.git
cd gh-bump

# Add to PATH (optional)
export PATH="$PATH:$(pwd)/bin"
```

## Usage

### Commands

```bash
gh-bump [options] [command]

Commands:
  discover   Find repos with Dependabot alerts (default)
  fix        Apply fixes and create PRs
  merge      Process pending PRs (wait for CI, merge)
  report     Show summary report
  all        Run full workflow: discover → fix → merge
```

### Options

| Option | Description |
|--------|-------------|
| `--pattern=OWNER/PREFIX` | Filter repos matching glob pattern |
| `--repo=OWNER/REPO` | Process single repo only |
| `--org=ORG` | Process all repos in organization |
| `--severity=LEVEL` | Filter alerts: `critical`, `high`, `medium`, `low` |
| `--dry-run` | Show what would happen without changes |
| `--no-merge` | Create PRs but skip auto-merge |
| `--timeout=MINUTES` | CI wait timeout (default: 30) |
| `--parallel=N` | Max concurrent repos (default: 5) |
| `--verbose` | Enable debug output |

### Examples

```bash
# Discover all repos with Dependabot alerts
gh-bump discover

# Dry-run on repos starting with "myorg/web-"
gh-bump --pattern=myorg/web- --dry-run fix

# Fix critical alerts only, no auto-merge
gh-bump --pattern=myorg/api- --severity=critical --no-merge fix

# Process a single repo end-to-end
gh-bump --repo=owner/repo all

# Full workflow for an org
gh-bump --org=mycompany all

# Just merge pending PRs from previous run
gh-bump merge

# Show summary report
gh-bump report
```

## Workflow

1. **Discovery** — Enumerates repos and queries Dependabot API for open alerts
2. **Fix** — Clones each repo, detects ecosystem, runs native fix command
3. **PR Creation** — Commits changes, pushes branch, creates PR with alert summary
4. **CI Wait** — Polls PR status until all checks complete
5. **Merge** — Verifies mergeability, squash-merges, deletes branch

### State Files

```
./state/
├── repos.json        # Cached repo + alert manifest
├── operations.json   # Per-repo status tracking
└── rollback.sh       # Auto-generated revert commands

./logs/
└── {repo_name}.log   # Per-repo operation log
```

## Supported Ecosystems

| Ecosystem | Lock File | Fix Command |
|-----------|-----------|-------------|
| npm | `package-lock.json` | `npm audit fix` |
| Yarn | `yarn.lock` | `yarn upgrade` |
| pnpm | `pnpm-lock.yaml` | `pnpm audit --fix` |
| pip | `requirements.txt` | `pip-audit --fix` |
| Bundler | `Gemfile.lock` | `bundle update` |
| Cargo | `Cargo.lock` | `cargo update` |
| Composer | `composer.lock` | `composer update` |
| Go | `go.sum` | `go get -u && go mod tidy` |
| Maven | `pom.xml` | `mvn versions:use-latest-releases` |
| NuGet | `*.csproj` | `dotnet-outdated --upgrade` |

## GitHub Token Permissions

For fine-grained PAT, enable:
- **Repository access**: All repositories (or specific repos)
- **Permissions**:
  - `Dependabot alerts`: Read
  - `Contents`: Read and write
  - `Pull requests`: Read and write
  - `Metadata`: Read

## Safety

- **Dry-run first**: Always test with `--dry-run` before running for real
- **Single repo test**: Use `--repo=owner/test-repo` to validate on one repo
- **Review PRs**: Even with auto-merge, review the generated PRs
- **Rollback script**: If needed, run `./state/rollback.sh` to close PRs

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DRY_RUN` | `false` | Same as `--dry-run` |
| `VERBOSE` | `false` | Same as `--verbose` |
| `CI_TIMEOUT` | `1800` | CI wait timeout in seconds |
| `WORK_DIR` | `/tmp/gh-bump` | Working directory for clones |
| `STATE_DIR` | `./state` | State file directory |
| `LOG_DIR` | `./logs` | Log file directory |
| `RATE_LIMIT_DELAY` | `1` | Seconds between API call bursts |

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
