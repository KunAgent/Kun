## MODIFIED Requirements

### Requirement: Extensions self-register direct right-workspace entries
Kun SHALL render every visible `views.rightSidebar` contribution as a direct, independently selectable icon in the Code vertical launcher rail. The entry MUST use the extension-declared packaged icon when valid, MUST use a Host-owned fallback when absent, MUST retain the fully qualified contribution identity for selection and accessibility, and MUST open or activate an independently closable top-level tab.

#### Scenario: Extension declares an icon and right-sidebar View
- **WHEN** an enabled, compatible, trusted extension declares `views.rightSidebar` View `editor` with a valid packaged icon
- **THEN** Kun SHALL display that icon and localized title in the launcher rail and clicking it SHALL open or activate `extension:<extension-id>/editor` as a right-workspace tab

#### Scenario: Extension omits its icon
- **WHEN** a visible right-sidebar View has no icon
- **THEN** Kun SHALL render an accessible Host-owned fallback icon without executing extension code

#### Scenario: Installed extension awaits workspace review
- **WHEN** an enabled and compatible extension declares a right-sidebar View but the active workspace has not reviewed that version
- **THEN** Kun SHALL show a locked, localized Host-owned rail entry containing only bounded manifest display metadata
- **AND** clicking it SHALL open Kun's protected permission review without creating a View Session or activating extension code before approval
- **AND** approval SHALL refresh contribution discovery and open the same View as a tab

#### Scenario: Host requests an extension icon resource
- **WHEN** Kun renders a declared extension icon in the launcher rail or tab
- **THEN** the resource protocol SHALL serve only an exact manifest-declared icon path as an image and SHALL retain existing isolation for scripts, Views, and undeclared package files

### Requirement: Extension UI navigation has no nested aggregate launcher
Kun SHALL expose extension Views directly on the vertical launcher rail. The workbench SHALL NOT render a duplicate tool menu or nested puzzle popover for extension Views.

#### Scenario: Multiple extensions register right-sidebar Views
- **WHEN** two enabled extensions each contribute one visible right-sidebar View
- **THEN** the launcher rail SHALL show two direct extension entries in deterministic order and each selection SHALL own an independent top-level tab

#### Scenario: Only a legacy full-page View is installed
- **WHEN** an Extension API v1 manifest contributes a permitted `views.fullPage` View but no right-sidebar View
- **THEN** the manifest SHALL remain compatible but Kun SHALL NOT create a launcher-rail entry for that View

### Requirement: Host owns extension tab placement and lifecycle
An opened extension right-sidebar View SHALL use the Host-owned resizable right workspace, tab focus, collapse, persistence, trust, permission, and View Session lifecycle. Extension code MUST NOT select absolute coordinates, replace the tab strip, overlay protected UI, or receive private renderer access.

#### Scenario: User opens a docked extension tab
- **WHEN** the user selects a direct extension launcher-rail icon
- **THEN** Kun SHALL open its isolated View beside the main conversation at a useful Host-clamped width while preserving user resize, tab switching, and collapse controls

#### Scenario: Permission is revoked while open
- **WHEN** a permission required by an open extension tab is revoked
- **THEN** Kun SHALL remove the menu entry and tab, dispose the View Session, and retain unrelated built-in and extension tab state

#### Scenario: Active conversation has its own workspace
- **WHEN** the selected conversation workspace differs from the globally selected project workspace
- **THEN** contribution discovery, trust evaluation, command invocation, View Session creation, tab persistence, and panel rendering SHALL all use the selected conversation workspace used by the main Agent

#### Scenario: Workspace-aware Node View activates
- **WHEN** Kun activates or reactivates a trusted workspace-scoped Node extension for an open tab
- **THEN** the Extension Host SHALL receive an active and trusted SDK workspace context for the same admitted root and workspace identity

#### Scenario: Sandboxed View uses a permitted job service
- **WHEN** an admitted View with `jobs.manage` calls a documented jobs method through the Desktop Host
- **THEN** the Desktop Host and Kun Runtime SHALL both admit the request and the broker SHALL enforce ownership and permission checks

### Requirement: Legacy View contracts remain parse-compatible
Extension API v1 schemas and runtime routing SHALL continue to accept documented non-right View contribution points. New Kun guidance and bundled examples SHALL identify `views.rightSidebar` as the canonical discoverable extension UI opened from the direct launcher rail into its own tab.

#### Scenario: Existing extension is validated after the redesign
- **WHEN** an existing compatible manifest declares a documented non-right View contribution
- **THEN** validation SHALL continue to accept it subject to its existing permissions and constraints

### Requirement: Host-rendered extension chrome follows Kun locale
Extension API manifests SHALL support bounded locale overlays for extension metadata and known contribution display fields. Kun SHALL resolve those fields for its current locale anywhere the Host renders extension copy, including rail tooltips, tab titles, Extension Center entries, settings, and result-preview titles, while retaining the manifest's base language as fallback.

#### Scenario: Chinese Kun opens the bundled video extension
- **WHEN** Kun's locale is Simplified Chinese and the video manifest provides a matching overlay
- **THEN** the rail tooltip, tab title, management metadata, settings copy, and result-preview title SHALL render in Chinese without changing contribution identifiers

#### Scenario: Requested locale is not declared
- **WHEN** Kun selects a locale for which an extension has no exact or language fallback
- **THEN** Host chrome SHALL use the validated base manifest strings and SHALL not reject or mutate the extension
