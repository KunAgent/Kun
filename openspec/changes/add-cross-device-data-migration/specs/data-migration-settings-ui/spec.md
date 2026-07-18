## ADDED Requirements

### Requirement: Dedicated Settings category
The renderer SHALL expose a Data Migration category in the Settings sidebar and route it to a dedicated section without adding an agent selector, runtime diagnostics panel, or second runtime surface.

#### Scenario: User opens Data Migration
- **WHEN** the user selects Data Migration in Settings
- **THEN** the main pane shows export and import entry cards, a permanent never-transferred summary, and recent/recoverable operation reports

#### Scenario: Settings deep link is used
- **WHEN** an application action opens the `dataMigration` settings route
- **THEN** the correct sidebar item and main section are selected and keyboard focus reaches the section heading

### Requirement: Clear landing actions and safety boundaries
The landing section SHALL present Create migration package and Select migration package as distinct primary actions and SHALL state that credentials, OAuth, trust/approvals, and running processes are not transferred.

#### Scenario: First-time user views the page
- **WHEN** there is no prior migration operation
- **THEN** the page explains what each action does and what will require reconfiguration on the destination without requiring runtime knowledge

### Requirement: In-page export workflow
The export experience SHALL use a persistent in-page step workflow for Scope, Contents and security, Review, Create, and Report, and SHALL preserve user selections while navigating backward before export begins.

#### Scenario: User reviews workspace selection
- **WHEN** the Scope estimate completes
- **THEN** each workspace row shows selection state, path, counts, estimated bytes, related thread count, and relevant Design/Write badges

#### Scenario: Export is blocked by running work
- **WHEN** Review detects a running selected thread
- **THEN** the page names the affected work and offers wait, interrupt, omit, or return without silently interrupting it

### Requirement: In-page import workflow
The import experience SHALL use a persistent in-page step workflow for Select, Inspect, Map workspaces, Resolve, Review, Import, and Report, and SHALL not label package inspection as an import mutation.

#### Scenario: Encrypted package is selected
- **WHEN** the package header requires a passphrase
- **THEN** the workflow requests it before inspection, explains that it is not recoverable, and does not retain it after the operation

#### Scenario: Package inspection succeeds
- **WHEN** all integrity and compatibility checks pass
- **THEN** the user sees package identity, source system/version, selected categories, counts, expanded bytes, and warnings before choosing destinations

### Requirement: Workspace mapping and conflict resolution UI
The UI SHALL show every workspace destination mapping, file-system incompatibility, unresolved path, thread/provider issue, and differing-file conflict, SHALL default to new folder/Keep both, and SHALL prevent import while a fatal decision remains unresolved.

#### Scenario: Fatal file-name collision exists
- **WHEN** two source names collide on the chosen destination file system
- **THEN** the issue count is visible, Start import is disabled with a reason, and activating the reason focuses the first unresolved item

#### Scenario: User applies a bulk file decision
- **WHEN** the user applies Keep target, Save imported copy, Replace with backup, or Skip to a directory or conflict group
- **THEN** the UI previews the affected count and permits undo before import starts

### Requirement: Accurate progress and navigation
The UI SHALL display current phase plus byte/item progress, SHALL allow the user to leave and return to a long-running operation, and SHALL expose a persistent application-level return affordance while work continues.

#### Scenario: User leaves Settings during staging
- **WHEN** staging continues in the main process
- **THEN** a persistent progress surface shows status and returns to the operation without starting a second task

#### Scenario: Progress lacks a reliable duration estimate
- **WHEN** insufficient samples exist for a stable ETA
- **THEN** the UI shows determinate bytes/items or indeterminate phase progress and does not invent an exact completion time

### Requirement: Phase-aware cancellation
The UI SHALL explain cancellation consequences for the current phase and SHALL keep cancellation separate from the primary progress control.

#### Scenario: Cancel during inspection
- **WHEN** the user cancels package inspection
- **THEN** the workflow returns to Select and states that the destination was not changed

#### Scenario: Cancel during commit
- **WHEN** the user requests cancellation after commit begins
- **THEN** the confirmation states that Kun will finish the current atomic action and roll back, and the UI tracks rollback rather than immediately showing cancelled

### Requirement: Durable recovery experience
The Settings section SHALL prioritize an incomplete migration journal, SHALL explain the last durable phase and destination impact, and SHALL offer Resume, Roll back, and View details before another mutation operation can start.

#### Scenario: App restarts after a crash
- **WHEN** an incomplete operation is detected at launch or when Settings opens
- **THEN** the recovery card replaces normal mutation actions until the operation is resumed, rolled back, or resolved

#### Scenario: Rollback needs manual intervention
- **WHEN** identity checks prevent safe automatic rollback of a user-modified path
- **THEN** the UI preserves the data, shows a manual recovery checklist and report location, and does not claim rollback success

### Requirement: Completion and next actions
The completion page SHALL distinguish full success, completed with review items, rolled back, and failed states and SHALL provide relevant next actions such as opening an imported workspace/history, configuring a provider, reauthenticating, reviewing disabled schedules, and viewing the report.

#### Scenario: Credentials were excluded
- **WHEN** import otherwise completes successfully
- **THEN** the completion page lists provider/channel reconfiguration as expected follow-up rather than an import failure

#### Scenario: Files were renamed or skipped
- **WHEN** import commits with explicit rename or skip decisions
- **THEN** the page shows their counts and a direct path to the mapping/conflict report

### Requirement: Actionable errors
Every migration error surface SHALL state the failed phase, stable error code, whether destination data was untouched or rolled back, and at least one safe next action; raw stack traces SHALL not be the primary message.

#### Scenario: Package integrity fails
- **WHEN** inspection finds a checksum or authentication error
- **THEN** the page states that the package cannot be trusted, confirms the destination was not modified, and suggests selecting another package or exporting again

#### Scenario: Disk becomes full
- **WHEN** staging reports insufficient space
- **THEN** the page identifies the affected target, confirms commit did not begin, and offers cleanup or destination remapping

### Requirement: Accessibility and localization
The Data Migration section SHALL support Chinese and English, keyboard-only operation, visible focus, assistive-technology labels and live progress, and status indicators that do not rely on color alone.

#### Scenario: Screen reader observes progress
- **WHEN** an export or import phase or meaningful percentage changes
- **THEN** the accessible status communicates the phase and progress without announcing high-frequency file events individually

#### Scenario: Keyboard user resolves conflict
- **WHEN** a keyboard-only user navigates the conflict list
- **THEN** they can inspect details, choose a resolution, apply or undo a bulk action, and reach the next unresolved conflict in a logical focus order

### Requirement: Single active mutation operation
The application SHALL allow at most one export creation or import mutation operation at a time and SHALL make concurrent-action unavailability explicit without discarding safe completed inspection results.

#### Scenario: Import is committing and user clicks export
- **WHEN** another mutation operation owns the migration lock
- **THEN** Create migration package is disabled with a link to the active operation
