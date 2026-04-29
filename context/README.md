# Public Form Logger — Context Mesh

This directory holds the **non-code knowledge** that keeps the project
maintainable: architecture, constraints, decisions, and operational playbooks.

## Layout

| Folder | What lives here |
|---|---|
| `architecture/` | High-level diagrams and component responsibilities. |
| `constraints/` | Rules the project enforces (folder layout, naming, forbidden patterns). |
| `decisions/` | Architecture Decision Records (ADRs), one per important call. |
| `playbooks/` | Step-by-step guides for recurring tasks. |

## Reading order for newcomers

1. [`architecture/overview.md`](architecture/overview.md) — what the service does.
2. [`decisions/adr-001-service-independence.md`](decisions/adr-001-service-independence.md) — why it is standalone.
3. [`decisions/adr-002-public-token-validation.md`](decisions/adr-002-public-token-validation.md) — how the public endpoint validates input.
4. [`decisions/adr-003-idempotency.md`](decisions/adr-003-idempotency.md) — how duplicates are handled.
5. [`constraints/project-structure.md`](constraints/project-structure.md) — folder layout rules.
6. [`playbooks/adding-a-feature.md`](playbooks/adding-a-feature.md) — how to ship a change.
