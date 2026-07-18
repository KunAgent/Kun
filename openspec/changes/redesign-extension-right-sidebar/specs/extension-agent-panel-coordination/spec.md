## ADDED Requirements

### Requirement: Main Agent and panel coordinate through registered extension tools
An extension panel and the main Kun Agent SHALL coordinate through the extension's authenticated, schema-validated tool surface and workspace-scoped extension state. Kun SHALL NOT expose main-renderer React state, conversation DOM, runtime credentials, or private guest IPC as a coordination mechanism.

#### Scenario: Agent edits the panel's active project
- **WHEN** the main Agent resolves the extension's active project and invokes an authorized mutation tool with its expected revision
- **THEN** the extension SHALL commit the revision through the same project service used by the panel and SHALL publish a bounded project-change event

#### Scenario: Agent attempts a stale edit
- **WHEN** the Agent invokes a mutation using a revision older than the panel's current project revision
- **THEN** the tool SHALL reject the mutation with the current revision and the panel and Agent SHALL be able to refresh without an implicit merge

### Requirement: Active panel context is explicit and workspace-scoped
An extension that supports Agent-panel coordination SHALL expose an explicit tool operation for resolving the active panel resource. The pointer MUST be stored only in the extension's workspace namespace, MUST be validated before use, and MUST return an explicit empty or stale outcome rather than guessing.

#### Scenario: Panel opens a project
- **WHEN** the user opens or creates a project in the extension panel
- **THEN** the extension SHALL record that project as active for the current trusted workspace and the Agent-facing lookup SHALL return its current revision

#### Scenario: No project is active
- **WHEN** the main Agent asks for active panel context before the user selects a project
- **THEN** the tool SHALL return an explicit no-active-project outcome without selecting an arbitrary project

### Requirement: Open panels observe Agent-originated changes
The extension SHALL publish bounded, attributable workspace events after successful Agent or manual project mutations. An open panel displaying the affected project SHALL refresh from authoritative extension state and SHALL preserve optimistic revision checks.

#### Scenario: Main Agent completes a timeline edit
- **WHEN** an Agent tool commits a new revision for the project currently displayed by the panel
- **THEN** the panel SHALL receive a bounded project-change event and reload that revision without reading conversation content

### Requirement: Agent tools are isolated by workspace ownership
Workspace-scoped extension Hosts and their registered Agent tools SHALL be discoverable and invokable only from the workspace that activated them. A failed or pending activation in another workspace MUST NOT reuse registrations or storage from the first workspace.

#### Scenario: A second workspace activates the same extension
- **WHEN** workspace B discovers or invokes the video tools after workspace A activated them
- **THEN** Kun SHALL activate an independently scoped Host for B or fail closed, and SHALL never return or mutate workspace A's project data

#### Scenario: Tool catalog is built after workspace activation fails
- **WHEN** a workspace-scoped Host cannot activate for the calling workspace
- **THEN** stale tool registrations from another workspace SHALL be absent from that Agent's catalog and rejected at invocation

### Requirement: View events are isolated by workspace ownership
Extension View events SHALL be routed by both extension identity and admitted workspace scope. A session SHALL receive only events published by its own scoped Host.

#### Scenario: Two workspaces have an open video panel
- **WHEN** the Host in workspace A publishes a project or active-project change
- **THEN** only workspace A View Sessions SHALL receive it and workspace B SHALL remain unchanged

### Requirement: Read-only Agent polling does not require destructive approval
Read-only render status lookup SHALL be a separate non-side-effecting tool operation from render cancellation. Cancellation SHALL retain explicit side-effect metadata and approval behavior.

#### Scenario: Agent polls a running export
- **WHEN** the Agent reads render status repeatedly
- **THEN** Kun SHALL execute the reads without requesting destructive approval, while a cancellation request SHALL still use the side-effecting tool
