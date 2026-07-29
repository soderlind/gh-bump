# Shared Platform Layer

This context defines cross-cutting execution concerns reused by multiple bounded contexts.
It exists to keep operational modes and safety mechanisms consistent without polluting domain language.

## Language

**Execution Mode**:
A cross-cutting runtime mode that changes how operations are executed without redefining domain concepts.
_Avoid_: business state, workflow type

**Dry Run Mode**:
An execution mode that reports intended actions without applying external or local mutations.
_Avoid_: preview context, simulated domain flow

**Unattended Merge Mode**:
An execution mode in which a run is configured to merge its own output, so no human reviews the change before it lands.
_Avoid_: auto-merge, unsupervised run, headless mode

**Dry-Run Non-Artifact Rule**:
A rule that dry-run does not produce domain success or failure artifacts; it only emits execution previews.
_Avoid_: dry-run success state, simulated failure artifact

**Workload Cap Policy**:
A cross-cutting policy that limits unit-of-work volume per run to bound runtime and operational risk.
_Avoid_: domain batch size, business quota

**Cost Guardrail Policy**:
A cross-cutting policy that limits expensive calls per run to control spend and execution blast radius.
_Avoid_: remediation logic, fix quality rule

**Outcome Classification**:
A run result must carry an explicit outcome type separate from optional diagnostic text so success, no-fix, failure, and budget-skip are unambiguous.
_Avoid_: nullable-error status, implicit outcome

**Budget Stop Outcome**:
Exhausting configured call or workload limits is a distinct non-failure stop reason representing intentional policy enforcement.
_Avoid_: processing failure, runtime defect

**Outcome Granularity Rule**:
Outcome classification is assigned per group attempt, while run-level reporting aggregates counts across outcome types rather than collapsing to one status.
_Avoid_: single run status, flattened outcome

**Outcome Precedence Rule**:
When multiple interpretations compete for one group attempt, precedence is failed over no-fix over budget-stop over success.
_Avoid_: ambiguous precedence, last-event wins

**Outcome Mapping Contract**:
Bounded contexts may use context-specific outcome labels, but each label must map to shared-platform outcome classes for consistent aggregation and analytics.
_Avoid_: unmapped labels, taxonomy drift

**Repository Port**:
The declared interface through which a context reaches a repository, satisfied by a live GitHub adapter in production and an in-memory adapter in tests.
_Avoid_: GitHub client, API wrapper

**Run Report**:
The single aggregated view of a run's outcome counts, per-group lines, and exit code, which entrypoint adapters emit without re-deriving.
_Avoid_: summary printer, per-adapter status output
