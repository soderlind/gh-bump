# Security Remediation

This context resolves dependency vulnerability alerts into reviewable pull requests.
It exists to reduce security risk while preserving human control over merges.

## Language

**Alert Group**:
A set of open vulnerability alerts that target the same manifest path and are handled as one unit of change.
_Avoid_: batch, bundle, set

**Editable Manifest Key**:
The canonical manifest path used to group alerts into one remediation unit, including lockfile-to-manifest remapping when needed.
_Avoid_: source path, raw manifest key

**Alert Provenance Path**:
The original manifest path reported by the alert before any grouping remap, retained for traceability.
_Avoid_: canonical path, grouping key

**Fix Plan**:
A proposed file-level change set and pull-request metadata intended to remediate an alert group.
_Avoid_: patch script, recipe, auto-fix

**Fix Plan Scope Boundary**:
A validity rule that fix-plan file changes are limited to the editable manifest set for the alert group, with no out-of-scope files.
_Avoid_: broad patch, opportunistic edits

**Fix Plan Content Boundary**:
A validity rule that a fix plan may only alter the dependency-declaring parts of a manifest, leaving every other part of the file unchanged.
_Avoid_: content validation, diff check, sanitization

**Verifiable Manifest**:
A manifest whose format has a declared set of dependency-declaring parts, making the Fix Plan Content Boundary enforceable for it; formats that are executable code can never join this set.
_Avoid_: supported manifest, parseable file

**Planning Eligibility**:
A precondition, applied before any fix plan is requested, that an alert group's manifest is a Verifiable Manifest whenever the run is in Unattended Merge Mode.
_Avoid_: pre-filter, skip rule, gate

**Fix Plan Admission**:
The single decision that turns a model response into either an admitted Fix Plan or a No Fix Produced Outcome, applying parsing, the Fix Plan Scope Boundary, the Fix Plan Content Boundary, and ecosystem dependency rules together.
_Avoid_: validation chain, sanity checks, guard rails

**Severity Threshold**:
The minimum vulnerability severity that defines which alerts are eligible for remediation in a run.
_Avoid_: runtime knob, generic filter

**Remediation Pull Request**:
A pull request created to apply a fix plan for one alert group.
_Avoid_: upgrade PR, bot PR

**No Fix Produced Outcome**:
A first-class remediation outcome where an alert group completes without a remediation pull request due to plan absence, invalidity, or safety rejection.
_Avoid_: transport failure, infrastructure outage

**No-Fix Retry Boundary**:
A no-fix outcome is terminal within the current run and may be retried only in a subsequent run with changed inputs or configuration.
_Avoid_: in-run fallback loop, hidden auto-retry

**Outcome Label Mapping**:
Security Remediation outcome labels map to shared-platform outcome classes for run aggregation and cross-context reporting.
_Avoid_: isolated status labels, unmapped outcomes

**Terminal Remediation Artifact**:
The remediation context ends at the creation of a reviewable remediation pull request; merge, tag, and release are downstream lifecycle concerns.
_Avoid_: end-to-end release fix, remediation deployment
