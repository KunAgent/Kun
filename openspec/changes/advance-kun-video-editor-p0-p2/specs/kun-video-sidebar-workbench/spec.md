## ADDED Requirements

### Requirement: The video editor is usable at every Host sidebar width
The Kun Video Editor View SHALL remain actionable from 280 px through 760 px without document-level horizontal scrolling, clipped project controls, or a desktop multi-column layout that is unreachable inside the Host panel.

#### Scenario: Narrow empty-project sidebar
- **WHEN** the trusted editor View opens at 280 px with no active project
- **THEN** the visible first screen SHALL identify the editor, explain the next step, and expose project creation/import controls in normal document flow

#### Scenario: Preferred-width active project
- **WHEN** the editor opens near the Host preferred width with an active project
- **THEN** project identity, revision, bounded preview, primary workspace navigation, and current status SHALL be visible without traversing every editor panel

### Requirement: Primary workspaces use sidebar navigation
The View SHALL expose project work through one accessible primary workspace at a time, including script/captions, clips/media, timeline, properties, and output/history, while preserving state when the user changes workspaces.

#### Scenario: User changes the active editor workspace
- **WHEN** the user activates a workspace tab by pointer or keyboard
- **THEN** its panel SHALL become visible, non-active primary panels SHALL leave the accessibility tree, and project/playhead/selection state SHALL remain unchanged

### Requirement: Empty, loading, error, and recovery states are explicit
The View SHALL render bounded actionable states for initialization, missing project, failed Host request, revoked media, invalid project, and interrupted jobs instead of a blank document or an indefinitely disabled control surface.

#### Scenario: Project initialization fails after appearance loads
- **WHEN** locale/theme initialization succeeds but the project request fails
- **THEN** the View SHALL keep the Host appearance, show a localized error and recovery action, and not collapse to an empty white or dark area

### Requirement: The preview and project status remain compact
The View SHALL provide a compact project header and a collapsible or bounded preview that does not permanently displace the active editing workspace at narrow widths.

#### Scenario: User edits a long transcript in a narrow sidebar
- **WHEN** the transcript workspace is active and the project has playable media
- **THEN** the user SHALL be able to collapse or bound the preview while retaining playhead, project, and proof freshness status

### Requirement: Natural-language editing remains in the main Kun conversation
The View SHALL show Agent synchronization, active evidence, and last mutation/proof state but SHALL NOT require a second embedded chat to operate the editor.

#### Scenario: Main Agent changes the active project
- **WHEN** a workspace-scoped video tool commits a newer revision
- **THEN** the open sidebar SHALL refresh the authoritative project and show the attributable change without opening a private chat surface

### Requirement: Appearance and accessibility follow the Host live
All Host chrome and Webview copy SHALL follow supported Kun locale, theme, direction, contrast, reduced-motion, focus, and keyboard semantics without recreating the View Session.

#### Scenario: Locale changes while the editor is open
- **WHEN** Kun changes between English and Simplified Chinese
- **THEN** the sidebar title, navigation, empty state, controls, notices, and current document language SHALL update in place

#### Scenario: Keyboard-only navigation
- **WHEN** a user navigates the sidebar without a pointer
- **THEN** tabs, project actions, playback, timeline selection, editing commands, and job controls SHALL expose visible focus and correct roles, names, and states
