# Context Map

## Contexts

- [Security Remediation](./docs/contexts/security-remediation/CONTEXT.md) - analyzes dependency alerts and produces repository changes through pull requests.
- [Local Release Automation](./docs/contexts/local-release/CONTEXT.md) - prepares and optionally publishes local npm releases in a controlled workflow.
- [Shared Platform Layer](./docs/contexts/shared-platform/CONTEXT.md) - defines cross-cutting execution modes, safety checks, and infrastructure-level concerns used by multiple contexts.

## Relationships

- **Security Remediation -> Shared Platform Layer**: uses shared configuration parsing, logging, provider wiring, and execution guardrails.
- **Local Release Automation -> Shared Platform Layer**: uses shared configuration parsing, logging, provider wiring, and execution guardrails.
- **Security Remediation != Local Release Automation**: no business invariants are shared; only technical platform concerns are shared.
- **Local Release Automation !> AI/GitHub API**: local release remains deterministic and local-only; it does not call AI services or GitHub APIs.
- **Security Remediation -> Repository Lifecycle (downstream)**: merge, tag, and release happen after remediation PR creation and are outside remediation core language.
- **Dry Run Mode -> Shared Platform Layer**: dry-run behavior is modeled as an execution mode shared across contexts, not as context-specific domain language.
