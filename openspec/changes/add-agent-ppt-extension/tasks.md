## 1. Presentation Model And Projection

- [x] 1.1 Define the bounded schema-versioned presentation model, stable IDs, theme, text/shape/image elements, and canonical parser/serializer.
- [x] 1.2 Implement the typed operation reducer with changed IDs, inverse operations, validation warnings, revision-independent deterministic behavior, and unit tests.
- [x] 1.3 Implement safe standalone HTML projection and embedded-model extraction tests covering escaping, script markers, deterministic output, and invalid files.

## 2. Extension Host And Agent Tools

- [x] 2.1 Implement the revision-aware project service with per-path serialization, size limits, idempotency receipts, post-write verification, and conflict errors.
- [x] 2.2 Register create/read/apply/validate/export-copy tools and View commands through public Extension API v1, with progress, cancellation, bounded outputs, and change notifications.
- [x] 2.3 Expose the five presentation tools to the main Agent, omit extension-owned Agent profiles/runs, and test exact Manifest/runtime declaration parity.
- [x] 2.4 Accept practical main-Agent apply calls by deriving an omitted operation ID and normalizing supported slide/text defaults.

## 3. Visual Presentation Studio

- [x] 3.1 Build the right-sidebar Webview shell with deck path controls, tabbed slide rail/canvas/inspector, status, and responsive/themed styling.
- [x] 3.2 Implement slide and element creation, selection, ordering, drag/resize, inline text editing, property controls, undo/redo, preview, image resolution, and debounced revision-aware save.
- [x] 3.3 Keep Agent interaction in the main conversation, follow the path changed by main-Agent tools, refresh newer revisions, and discover the latest deck when the View opens after a mutation.
- [x] 3.4 Contribute a dedicated Presentation Studio icon and responsive right-sidebar View entry, with manifest parity and packed-asset coverage.
- [x] 3.5 Rename every user-visible extension surface to Kun PPT and label the generated standalone artifact as Kun PPT display HTML while preserving the stable extension ID.

## 4. Packaging And Documentation

- [x] 4.1 Add the Manifest, package scripts, TypeScript/Vite configuration, README, license, and clean-room reference notes.
- [x] 4.2 Add Presentation Studio to the extension examples index and validation enumeration.
- [x] 4.3 Add Presentation Studio to the product-owned bundled extension catalog, packaged-resource validation, and default-seeding smoke coverage.
- [x] 4.4 Version the sidebar-only package and allow bundled updates that only remove obsolete permissions without accepting permission additions.

## 5. Verification

- [x] 5.1 Run the extension's typecheck, build, unit tests, Manifest validation, and package validation.
- [x] 5.2 Run the repository extension example gate plus relevant root typecheck/build checks and diff hygiene.
- [x] 5.3 Exercise the built Webview in a browser harness and visually verify the narrow Slides, Canvas, and Properties sidebar layouts.
- [x] 5.4 Reproduce the failing main-Agent apply shape, add regression coverage, and verify an existing seeded profile upgrades to the sidebar-only package.
- [x] 5.5 Fix the inherited Electron drag region, preserve authored slide backgrounds, keep page thumbnails visible beside the active editor pane at usable sidebar widths, and add interaction/layout regressions.
- [x] 5.6 Preserve cached workspace authorization across immutable same/subset-permission updates, require review for permission additions, and make repeated identical permission application idempotent.
- [x] 5.7 Add a DOM layer tree and bounded CSS declaration editor that maps human HTML-style edits to typed operations without allowing arbitrary HTML, script, URL, selector, or CSS injection.
- [x] 5.8 Generate a sidebar-first UI concept, remove the conflicting desktop breakpoint tracks, compact deck actions, and verify the slide rail, canvas, toolbar, and properties pane at 420-640 px widths.
- [x] 5.9 Make selected-element Edit/Delete actions explicit, preserve keyboard focus after pointer selection, repair repeated-click inline text editing, and verify typed deletion plus autosave/undo behavior.
- [x] 5.10 Replace manual image-path entry with the operating system file chooser, bounded workspace import, collision-safe naming, and cancellation/type/size handling.
- [x] 5.11 Keep canvas text on one styled HTML layer in view and edit modes, enter plaintext editing without a white replacement field or automatic select-all, and verify keyboard commit/cancel behavior.

## 6. Presentation Artifact Handoff

- [x] 6.1 Surface PPT Master and extension presentation output paths as bounded successful presentation artifacts, including mapper coverage for output/destination path aliases.
- [x] 6.2 Render deduplicated post-turn presentation cards with system-default open, file-manager reveal, loading, and bounded failure states.
- [x] 6.3 Add focused artifact-derivation, mapper, PPT Master, and system-opener tests and run the relevant renderer/Kun/typecheck/build checks.
