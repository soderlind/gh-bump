# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-04-17

### Changed

- **Complete rewrite from bash to TypeScript**
- Fix logic now driven by LLM instead of hardcoded ecosystem patterns
- Works with any ecosystem the LLM understands (npm, pip, Go, Rust, Ruby, PHP, Java, C#, etc.)
- No git clone required — all file operations via GitHub API (Contents + tree/blob)
- Simplified CLI: single `--repo` flag, no subcommands

### Added

- **AI-powered fix engine**: LLM analyzes alert details + manifest files to determine minimal fix
- **Provider-agnostic LLM support**: OpenAI and Anthropic via Vercel AI SDK
- **GitHub Action**: Reusable `action.yml` for scheduled Dependabot fix automation
- **Cost guardrails**: `--max-alerts` and `--max-llm-calls` flags to cap AI usage
- **No-clone commits**: Git tree/blob API for creating commits without cloning
- **LLM tool use**: Agent can read files and list directories to explore repo structure

### Removed

- Hardcoded ecosystem detection (npm, pip, cargo, etc.) — replaced by LLM
- Project type detection (WordPress, Next.js, etc.) — replaced by LLM
- Build/test workflow — no longer needed (LLM edits manifests only)
- Version bumping heuristics — replaced by LLM
- Changelog generation heuristics — replaced by LLM
- Multi-repo discovery/batch processing (v1 feature, may return later)
- State tracking and rollback scripts (simplified architecture)
- Dependencies on `gh` CLI and `jq`

## [1.1.0] - 2026-04-17 (bash)

### Added

- **Project type detection**: Auto-detect repository type for appropriate workflows
  - WordPress Block Plugin (with @wordpress/scripts)
  - WordPress Plugin (standard PHP plugins)
  - WordPress Theme
  - npm Package
  - Next.js App
  - Python Package (poetry/pipenv/pip)
  - Composer Package
  - Go Module
- **Build workflow**: Run project-specific build commands after fixing deps
  - `npm install` + `npm run build` for JS projects
  - `composer install` for PHP
  - `poetry/pipenv/pip install` for Python
  - `go build` for Go
- **Version bumping**: Automatic semver version increments
  - WordPress plugin/theme headers
  - package.json
  - pyproject.toml
  - composer.json
  - New CLI flags: `--bump-version`, `--release-type=patch|minor|major`
- **Changelog updates**: Auto-add security fix entries
  - Supports Keep a Changelog format
  - WordPress readme.txt changelog section
  - New CLI flag: `--skip-changelog`
- **Test execution**: Optional test run before PR creation
  - New CLI flag: `--run-tests`
- **Skip build option**: Skip build step when not needed
  - New CLI flag: `--skip-build`

### Changed

- PR workflow now includes project detection, build, and optional version bump
- Logging improvements for post-fix workflow steps

## [0.1.0] - 2026-04-17

### Added

- Initial release
- **Discovery**: Enumerate repos with open Dependabot alerts
  - Support for personal and organization repos
  - Pattern filtering (`--pattern=owner/prefix`)
  - Severity filtering (`--severity=critical|high|medium|low`)
  - Result caching with TTL
- **Fix application**: Ecosystem-aware dependency updates
  - npm (`npm audit fix`)
  - Yarn (v1 and v2+)
  - pnpm (`pnpm audit --fix`)
  - pip/Python (`pip-audit --fix`)
  - Bundler/Ruby (`bundle update`)
  - Cargo/Rust (`cargo update`)
  - Composer/PHP (`composer update`)
  - Go modules (`go get -u`)
  - Maven (`mvn versions:use-latest-releases`)
  - NuGet/dotnet (`dotnet-outdated`)
- **PR workflow**: Automated branch, commit, and PR creation
  - Standard commit message format
  - PR body with alert summary
  - Auto-merge option via GitHub's native feature
- **CI integration**: Wait for checks before merge
  - Configurable timeout
  - Mergeability verification
  - Squash merge with branch cleanup
- **Safety features**:
  - Dry-run mode
  - State tracking for resume
  - Per-repo logging
  - Auto-generated rollback script
- **CLI interface**:
  - Commands: `discover`, `fix`, `merge`, `report`, `all`
  - Comprehensive help (`--help`)

### Technical

- Pure bash implementation (bash 4.0+)
- Dependencies: `gh` (GitHub CLI), `jq`
- Modular library structure (`lib/*.sh`)

---

Assisted-by: Claude:claude-opus-4-20250514
