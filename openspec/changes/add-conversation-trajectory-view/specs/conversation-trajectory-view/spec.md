## ADDED Requirements

### Requirement: Conversation trajectory center view
The workbench SHALL provide a conversation-scoped `chat | trajectory` center view toggle in the title bar and SHALL keep the conversation composer and chat component state mounted across view changes.

#### Scenario: Open and close trajectory
- **WHEN** a user activates the trajectory button for a Code conversation and later activates it again
- **THEN** the center content switches to trajectory and back to chat without changing the active thread, draft, model, permission mode, or prior chat scroll state

#### Scenario: Trajectory button status
- **WHEN** the selected conversation has an active model request or its most recent request failed
- **THEN** the title-bar button exposes the corresponding running or failure indicator and its pressed accessibility state

### Requirement: Chronological scalable ledger
The trajectory view SHALL project request metadata and canonical Session items into stable Turn and Step groups, render records chronologically, support backward pagination, and virtualize variable-height rows.

#### Scenario: Prepend older history
- **WHEN** the user loads a page older than the current trajectory window
- **THEN** older groups are prepended without changing the selected record or the visible scroll anchor

#### Scenario: Large trajectory
- **WHEN** a conversation contains ten thousand trajectory records
- **THEN** only the visible overscan window is mounted in the ledger DOM

### Requirement: Timeline, filtering, and summary
The trajectory view SHALL provide input/model/tool lanes, all/LLM/tool/error filters, bounded-content search, collapse controls, real-time/equal-width display modes, and all-session summary metrics.

#### Scenario: Timeline selection
- **WHEN** a user selects a model or tool block in the timeline
- **THEN** the corresponding ledger row becomes selected, scrolls into view, and drives the detail inspector

#### Scenario: Search and filter
- **WHEN** a user supplies a filter or query covering metadata or retained previews
- **THEN** only matching records are returned while the all-session summary remains accurate

### Requirement: Record inspection
The view SHALL provide type-appropriate overview, input/arguments, output/result, usage, timing, and normalized raw detail sections, and SHALL distinguish unavailable, truncated, evicted, failed, cancelled, and interrupted detail.

#### Scenario: Content capture disabled
- **WHEN** lifecycle metadata exists but complete request capture was disabled
- **THEN** timing, usage, status, output references, and tool lifecycle remain inspectable while exact prompt sections explain that content was not captured

### Requirement: Live follow and per-thread state
The view SHALL follow new records only while the ledger is at its live edge and SHALL isolate trajectory filter, query, selection, collapse, scroll, inspector width, and timeline mode by thread.

#### Scenario: User inspects older records
- **WHEN** new records arrive after the user scrolls away from the live edge
- **THEN** the scroll position is preserved and a new-record counter offers an explicit return to the live edge

#### Scenario: Switch conversations
- **WHEN** the user switches between two conversations and returns
- **THEN** each conversation restores its own trajectory UI state

### Requirement: Responsive and accessible presentation
The trajectory inspector SHALL be docked above 1080px, overlay between 760px and 1079px, full-screen below 760px, and SHALL honor dark theme, keyboard operation, and reduced-motion preferences.

#### Scenario: Narrow center area
- **WHEN** the trajectory center width becomes less than 760px and a record is selected
- **THEN** the inspector occupies the center view with a working return-to-trajectory control

### Requirement: Agent Perspective entry migration
The workbench SHALL remove the Agent Perspective right-panel contribution, normalize its persisted layout identifier to no panel, and retain explicit content-capture controls through trajectory and Settings surfaces.

#### Scenario: Restore old layout
- **WHEN** a saved layout references the removed Agent Perspective right panel
- **THEN** the workbench opens normally with no duplicate inspector and all unrelated right-panel tabs preserved
