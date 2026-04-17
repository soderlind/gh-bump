# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `--merge-now` flag: Merge PR immediately instead of enabling auto-merge
  - Useful when repo doesn't have auto-merge enabled in settings
  - Uses `gh pr merge --squash --delete-branch`
- `--release` flag: Create GitHub release after merge (requires `--merge-now`)
  - Uses the bumped version number without 'v' prefix (e.g., `1.0.0`)
  - Auto-generates release notes from commits
- `--tag` flag: Create git tag after merge (requires `--merge-now`)
  - Uses the bumped version number without 'v' prefix (e.g., `1.0.0`)
- FAQ section in README covering common questions

### Fixed

- Dry-run mode now shows build, version bump, and changelog steps
- Version detection now works on macOS (replaced `grep -P` with portable `sed`)
- Auto-merge "clean status" message no longer shown as warning
- Version bump sed patterns now macOS-compatible (use `sed -E` + POSIX classes)
- WordPress readme.txt changelog now uses plain text (no markdown backticks)
- Single repo mode (`--repo=`) now properly fetches package info for changelog

## [0.2.0] - 2026-04-17

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
