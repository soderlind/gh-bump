# Content verification for unattended merges

## Status

Accepted

## Context

Repository content is included in prompts and may influence a model through prompt injection. Path-only Fix Plan admission prevents writes outside the fetched manifest set, but it does not prevent a plan from changing executable or otherwise security-sensitive content inside an allowed manifest. Human review mitigates that risk when a run stops at a pull request; Unattended Merge Mode removes that safeguard.

A blocklist cannot enumerate every dangerous manifest field. Structural comparison can instead prove that all content outside an explicit dependency allowlist is unchanged, but only for manifest formats with a declared structure. Requiring that proof for every run would remove useful reviewed pull requests for ecosystems that do not yet have a verifier.

## Decision

Fix Plans for `package.json` are admitted only when all content outside these exact key paths is structurally unchanged: `dependencies`, `devDependencies`, `optionalDependencies`, `peerDependencies`, `overrides`, `resolutions`, and `pnpm.overrides`. The prompt and validator derive this list from the same source.

Unattended Merge Mode requires a Verifiable Manifest before a model is called. For now, only `package.json` is verifiable. Other manifest formats may still produce pull requests for human review when unattended merging is disabled. Dry runs preserve the configured merge policy so their result matches the corresponding real run.

A rejection records a No Fix Produced Outcome with a reason that identifies content verification and recommends disabling merging for human review.

## Consequences

- Prompt-injected changes to fields such as `scripts`, `bin`, `pnpm.patchedDependencies`, and `pnpm.onlyBuiltDependencies` cannot be admitted for `package.json`.
- Unverifiable manifests consume no LLM budget in Unattended Merge Mode.
- Python, Ruby, PHP, Go, Rust, and Maven manifests cannot currently be fixed by unattended runs; structurally verifiable formats may be added with explicit allowlists later.
- Structural comparison intentionally ignores formatting and JSON key order.
- Executable manifest formats such as `Gemfile` cannot satisfy this verification model and require human review.
