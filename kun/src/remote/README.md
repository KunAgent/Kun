# Remote operations

Modules follow business capabilities, not delivery milestones. Keep each maintained file at or below 700 physical lines. When a file contains several responsibilities, move those responsibilities into named modules; do not introduce phase names, numbered fragments, or compressed formatting.

## Shared entry points

- `facade.ts` preserves authorization, validation, preflight, durable receipt admission, dispatch, and recovery order. Its fixed handler table composes the feature services; it does not implement their business rules.
- `contracts.ts` composes feature parameter schemas and defines the common trusted envelope.
- `catalog.ts` builds capability discovery from the feature services.
- `method-order.ts` preserves the existing public method and capability order. It is not an implementation grouping.
- `routes.ts` exposes the constrained local HTTP boundary.
- `cursor-codec.ts` encodes and validates scoped pagination cursors.

## Feature ownership

| Directory | Responsibility |
| --- | --- |
| `agents/` | Personal Agent profiles, conversations, directory, search, memory, commitments, reminders, library, appearance, lifecycle and profile import |
| `code/` | Code task creation, metadata, search, model selection and native history fork/rewind |
| `messages/` | Message reads/search, history versions and bounded external-source content |
| `execution/` | Queue operations, steering, resume and stop |
| `goals/` | Task goal reads and updates |
| `files/` | Authorized project files, attachment admission, local artifacts and transfer receipts |
| `approvals/` | Protected approval preparation/decisions and supplemental input |
| `attention/` | Pending-work projections |
| `groups/` | Group directory, history/events, members and mutations |
| `collaboration/` | Collaboration task and run projections |
| `plugins/` | Plugin discovery and authorized enablement |
| `schedules/` | Schedule projections and desktop schedule audit records |
| `sharing/` | Independent shared-task authorization, requests, projections and attachments |
| `notifications/` | Metadata-only notification events and feeds |
| `authorization/` | Operation scopes and readable-thread boundaries |
| `resources/` | Resource access shared by reads across capabilities |
| `requests/` | Durable receipts, request lookup and definitive rejection types |
| `runtime/` | Calls into the existing authenticated local HTTP runtime |

Feature schemas, services and tests stay with the feature they cover. `testing/` contains the runtime fixture shared by integration tests; `integration/` contains tests of cross-feature invariants. These are test responsibilities, not delivery phases.

The desktop Service Manager remains the physical business-data writer. The phone still uses the fixed operation vocabulary and API surface. A source reorganization must not change operation names, persisted receipt keys, fingerprints, history versions, scope checks, or recovery semantics. Adding a capability requires both its feature schema and an explicit dispatch owner; registration rejects missing or duplicate operations.
