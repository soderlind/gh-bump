# Local Release Automation

This context runs a local npm release workflow from verification through optional publish.
It exists to standardize release preparation while preventing accidental publication.

## Language

**Release Run**:
One end-to-end local execution of the release workflow, including checks and version mutation when allowed.
_Avoid_: pipeline, job, task

**Publish Gate**:
An explicit compound condition that must be true before the publish command is attempted: publish intent is set, execution is not dry-run, and npm authentication is valid. It does not gate earlier mutating release steps.
_Avoid_: toggle, switch, mode

**Clean Worktree Requirement**:
A precondition that local git state has no uncommitted modifications before mutating release files.
_Avoid_: tidy repo, clean checkout

**Local-Only Execution Boundary**:
A rule that release automation executes only local filesystem and local process operations, excluding AI services and GitHub API calls.
_Avoid_: smart release, remote-assisted release

**Progressive Run Semantics**:
A rule that each release step applies in order and a later failure may leave earlier local mutations in place.
_Avoid_: atomic release, all-or-nothing rollback

**Failed Release Run Artifact**:
The canonical post-failure artifact is the local working diff produced by the run, retained for human adjudication.
_Avoid_: ephemeral failure, rollback snapshot

**Completed Non-Publish Run**:
A successful release run outcome where verification and versioning steps complete and publication is intentionally skipped.
_Avoid_: partial success, aborted publish

**Completed Published Release Run**:
A successful release run outcome where publish is requested, the publish gate is satisfied, and package publication completes.
_Avoid_: generic success, non-publish completion

**Outcome Label Mapping**:
Local Release Automation outcome labels map to shared-platform outcome classes for run aggregation and cross-context reporting.
_Avoid_: local-only status vocabulary, unmapped outcomes
