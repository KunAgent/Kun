## ADDED Requirements

### Requirement: Presentation files are stable standalone HTML artifacts
The extension SHALL store each presentation as a standalone `.kun-ppt.html` file containing a schema-versioned structured model, stable document/slide/element IDs, a positive revision, and a deterministic visible HTML projection.

#### Scenario: Reopen a saved presentation
- **WHEN** the extension opens a presentation that it previously saved
- **THEN** every slide and element retains its ID, geometry, content, order, theme, and revision

#### Scenario: Open the file outside Kun
- **WHEN** a user opens the saved file in a regular browser
- **THEN** the file presents the slides in 16:9 playback and print layouts without depending on Kun private APIs

### Requirement: Human and Agent edits use the same operation semantics
The extension MUST route both Webview edits and Agent tool edits through the same validated typed-operation reducer and MUST produce inverse operations for reversible UI edits.

#### Scenario: Edit text visually
- **WHEN** the user changes a text element in the canvas or inspector
- **THEN** the change is represented as an element operation, saved with a new revision, and is visible to the next Agent read

#### Scenario: Apply an Agent batch
- **WHEN** the Agent applies multiple valid operations against the current revision
- **THEN** all operations commit as one revision and the open View refreshes to the same resulting model

#### Scenario: Apply a naturally generated Agent batch
- **WHEN** the main Agent omits an explicit operation ID or an inserted slide background and optionally supplies a supported text font family
- **THEN** Kun derives a bounded idempotency key, normalizes the omitted background to null, persists the supported font choice, and applies the batch without a schema-only failure

### Requirement: Concurrent edits fail closed
Every persisted mutation SHALL require an expected revision, SHALL serialize calls for the same case-folded workspace path inside one Extension Host, and SHALL reject a stale revision observed before persistence without overwriting the newer presentation. Cross-process atomic conditional writes are outside this requirement because Extension API v1 does not expose them.

#### Scenario: Agent uses a stale revision
- **WHEN** the user saves revision 7 after the Agent read revision 6 and the Agent submits an edit for revision 6
- **THEN** the edit fails with a revision-conflict result and revision 7 remains unchanged

#### Scenario: Retry a completed Agent operation
- **WHEN** the same operation ID and payload are retried after their response was lost
- **THEN** the extension returns the recorded resulting revision without applying the batch twice

### Requirement: The editor provides a complete bounded visual workflow
The extension SHALL contribute the editor only as a responsive right-sidebar View with a dedicated presentation icon. The editor SHALL expose Slides, Canvas, and Properties as focused sidebar tabs and support creating and loading a deck, slide navigation and ordering, text/shape/image elements, selection, drag, resize, inline text changes, property editing, undo/redo, preview, and debounced save. At usable sidebar widths, the page-thumbnail navigator SHALL remain visible beside Canvas and Properties; very narrow Views MAY collapse it into the Slides tab. The host SHALL mark the complete embedded View as non-draggable so its controls receive pointer input, and the renderer SHALL preserve each slide's authored background color.

#### Scenario: Open Kun PPT from the right activity rail
- **WHEN** the installed extension contributions are loaded in a trusted workspace
- **THEN** the right activity rail shows the Kun PPT icon and selecting it opens the responsive presentation editor

#### Scenario: Create and revise a deck
- **WHEN** a user creates a deck, adds slides and elements, moves and styles them, undoes one edit, and previews the result
- **THEN** the canvas, slide rail, inspector, preview, and saved standalone file show the same revision

#### Scenario: Navigate and edit in the right sidebar
- **WHEN** a presentation is loaded in a normal-width right sidebar
- **THEN** its authored background renders without a host CSS override, its page thumbnails remain visible beside the active editor pane, and the user can click deck actions, tabs, thumbnails, toolbar controls, and property inputs

#### Scenario: Resize the editor to a narrow workbench sidebar
- **WHEN** the right sidebar is resized between 420 and 640 CSS pixels while Canvas or Properties is active
- **THEN** the active pane stretches through the remaining sidebar height, the numbered thumbnail rail stays visible, the 16:9 canvas scales without horizontal clipping, and compact deck and editing actions remain reachable without producing empty implicit grid rows

#### Scenario: Edit or delete a selected canvas element
- **WHEN** the user selects a text element and repeats the click, presses Enter, or chooses the visible Edit action, or selects any element and chooses Delete or presses Delete or Backspace
- **THEN** text enters a focused inline editor, deletion removes the selected element through a typed operation, and both changes remain undoable and autosaved

#### Scenario: Preserve the rendered text while editing in place
- **WHEN** the user starts editing an existing text element on the canvas
- **THEN** the same positioned HTML text layer remains visible with its font, size, color, alignment, transparent background, and original content, and the caret is placed without clearing or selecting all text

#### Scenario: Insert an image through the operating system picker
- **WHEN** the user chooses Image, selects one supported image in the system file chooser, or cancels that chooser
- **THEN** a selected PNG, JPEG, GIF, or WebP within the size limit is copied to a unique workspace-relative asset and inserted through the typed editor, while cancellation leaves the deck unchanged and no absolute local path is exposed to the Webview or saved presentation

#### Scenario: Edit the HTML presentation as bounded DIV and CSS layers
- **WHEN** a user selects a text, shape, or image from the DOM layer tree, changes its order, or applies supported CSS declarations for layout and appearance
- **THEN** the editor maps those changes to the same typed element operations, keeps undo and autosave behavior, and regenerates the standalone HTML projection with matching DIV or image styles

#### Scenario: Ask the main Kun Agent to revise the open deck
- **WHEN** the user asks the main conversation Agent to revise a presentation while Presentation Studio is installed
- **THEN** the Agent can use the registered presentation tools and accepted file changes refresh the open sidebar editor without creating an extension-owned Agent run

#### Scenario: Agent creates a deck different from the current sidebar path
- **WHEN** the main Agent creates or modifies another root-level `.kun-ppt.html` while the sidebar is open
- **THEN** the sidebar follows that tool-written path and renders its current revision without moving Agent interaction out of the main conversation

#### Scenario: Open the sidebar after an Agent created a deck
- **WHEN** the sidebar has no restored deck and one or more root-level presentation files already exist
- **THEN** the sidebar loads the most recently modified valid `.kun-ppt.html` file

#### Scenario: Identify the generated display artifact
- **WHEN** the main Agent successfully creates a standalone `.kun-ppt.html` deck
- **THEN** the open Kun PPT sidebar renders it and the completed-turn file card identifies it as Kun PPT display HTML

### Requirement: Presentation content cannot control the extension Webview
The extension MUST render validated structured fields with safe DOM APIs and MUST NOT execute or inject arbitrary presentation HTML, CSS, JavaScript, remote resources, or event handlers into the bridge-bearing Webview.

#### Scenario: Text contains HTML and script syntax
- **WHEN** a text element contains tags, event-handler strings, or a closing script marker
- **THEN** the editor and standalone projection display it as text and the embedded model remains parseable

#### Scenario: CSS input attempts to escape the structured editor
- **WHEN** a user enters selectors, at-rules, comments, URLs, unsupported properties, or geometry outside the slide canvas in the CSS editor
- **THEN** Kun rejects the edit without changing the presentation model or injecting the input into the extension Webview

#### Scenario: Invalid image path
- **WHEN** an image element uses an absolute path, traversal, unsupported type, or unavailable file
- **THEN** validation rejects it or renders a bounded placeholder without exposing files outside the workspace

### Requirement: Completed presentation artifacts are directly openable
After an Agent turn completes, the GUI SHALL surface every successful, workspace-confined `.ppt`, `.pptx`, or trusted Presentation Studio `.kun-ppt.html` output as a deduplicated presentation file card. Native PowerPoint files SHALL open through the operating system's default application association, while `.kun-ppt.html` SHALL open through the same association as a standalone browser presentation. The card SHALL also allow revealing the file in the platform file manager. Before either action, the main process SHALL verify that the canonical target is a regular file inside the owning workspace and still has an allowed presentation suffix. Before system-opening `.kun-ppt.html`, it SHALL additionally recompute and match the trusted write-time SHA-256 digest.

#### Scenario: PPT Master exports a deck
- **WHEN** PPT Master successfully exports `presentations/brief.pptx` and the Agent turn completes
- **THEN** the final reply shows one presentation card whose primary action asks the operating system to open that file with its configured default application such as WPS or PowerPoint

#### Scenario: Kun PPT writes an HTML deck
- **WHEN** a successful presentation write tool reports `brief.kun-ppt.html`
- **THEN** the final reply shows one presentation card that can open the standalone HTML projection with the system default application

#### Scenario: Generic tool reports presentation-looking HTML
- **WHEN** a tool without trusted Presentation Studio provenance reports `evil.kun-ppt.html`
- **THEN** the GUI does not surface it as an executable standalone presentation card

#### Scenario: A trusted HTML deck changes before it is opened
- **WHEN** Presentation Studio reports a verified HTML deck but its bytes no longer match the write-time digest when the user clicks Open
- **THEN** the main process refuses to launch the browser and the card shows a bounded failure state

#### Scenario: Presentation tool runs through the progressive gateway
- **WHEN** a Presentation Studio write is wrapped by `extension_tool_call` as `result.content`
- **THEN** the GUI preserves its canonical tool provenance and workspace-write semantics and surfaces the completed deck normally

#### Scenario: Presentation path disguises another target type
- **WHEN** a reported `.pptx` path resolves to a directory or to a symlink target with a different suffix
- **THEN** the main process rejects the open or reveal action without launching an application

#### Scenario: Opening fails or the file moved
- **WHEN** the operating system cannot open a surfaced presentation path
- **THEN** the card remains visible, shows a bounded failure state, logs diagnostic detail, and does not fall back to an arbitrary command

#### Scenario: Repeated tools report the same deck
- **WHEN** multiple successful tool results in one turn refer to the same presentation path
- **THEN** the final reply shows that presentation only once

#### Scenario: Distinct case-sensitive paths are reported
- **WHEN** a case-sensitive workspace contains both `Deck.pptx` and `deck.pptx`
- **THEN** the final reply keeps both presentation cards rather than case-folding them into one

### Requirement: Extension declarations remain public and verifiable
The implementation SHALL use only public Extension API v1 surfaces, minimum Manifest permissions, bounded strict tool schemas, and declarations that exactly match runtime registration. It SHALL NOT declare an Agent profile or request `agent.run` permission.

#### Scenario: Validate and pack the extension
- **WHEN** repository extension checks build, validate, and pack all examples
- **THEN** Presentation Studio passes without unresolved browser imports, undeclared resources, private Kun imports, or tool declaration drift

### Requirement: Kun PPT is bundled as a default extension
Development and production builds SHALL include the stable Presentation Studio extension identity with the user-visible Kun PPT name in the product-owned bundled extension catalog beside Kun Video Editor, and Kun SHALL seed it through the normal extension registry without overriding an explicit user uninstall.

#### Scenario: Start with a clean profile
- **WHEN** Kun starts with a clean profile and the generated bundled extension catalog
- **THEN** both Presentation Studio and Kun Video Editor are installed and globally enabled through the normal registry

#### Scenario: Start after explicitly uninstalling Presentation Studio
- **WHEN** a user uninstalls the seeded Presentation Studio extension and restarts Kun
- **THEN** the bundled-extension seeder preserves that removal instead of resurrecting the extension

#### Scenario: Upgrade removes an obsolete permission
- **WHEN** a newer bundled Presentation Studio version requests only a subset of the permissions granted to the currently managed version
- **THEN** Kun installs and selects the safer update, preserves each reviewed workspace while narrowing its cached grant to the remaining permissions, and continues to reject any bundled update that adds a permission

#### Scenario: Reopen after a safe bundled update
- **WHEN** a user has authorized Kun PPT for a workspace and restarts after an immutable bundled update with the same or fewer accepted permissions
- **THEN** the extension remains authorized for that workspace without another consent prompt, while any later permission addition requires a fresh review
