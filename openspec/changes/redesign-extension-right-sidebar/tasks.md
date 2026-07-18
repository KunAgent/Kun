## 1. Right-sidebar host navigation

- [x] 1.1 Remove the aggregate extension View launcher and its renderer composition/tests while preserving legacy View routing
- [x] 1.2 Keep one direct rail icon and independent tab per visible right-sidebar contribution with declared-icon and fallback behavior
- [x] 1.3 Expand a selected extension panel to the Host-clamped preferred docked width and preserve normal resize/collapse behavior
- [x] 1.4 Confine Host-rendered extension icons to exact manifest declarations and the main renderer image CSP

## 2. Video editor extension migration

- [x] 2.1 Move the bundled video editor manifest to `views.rightSidebar`, add its packaged icon, and remove redundant open-editor UI/command contributions
- [x] 2.2 Add workspace-scoped active-project lookup to the video tool contract and persist validated active project selection
- [x] 2.3 Replace the embedded Agent prompt with a main-Agent synchronization panel and refine the responsive docked editor layout
- [x] 2.4 Update video extension tests, versioned release fixtures, README guidance, and deterministic bundled package assets
- [x] 2.5 Migrate historical installed Action IDs so the bundled right-sidebar update cannot block Kun startup

## 3. Public guidance and compatibility

- [x] 3.1 Document `views.rightSidebar` as the canonical self-registering UI in Chinese and English while retaining Extension API v1 compatibility notes
- [x] 3.2 Add or update host tests for direct icon registration, deterministic selection, legacy parse compatibility, and removal of the aggregate launcher

## 4. Verification and delivery

- [x] 4.1 Run focused renderer, extension API, video tool, package, and release-gate tests
- [x] 4.2 Run repository typecheck, lint, test, build, and OpenSpec validation
- [x] 4.3 Verify the bundled video editor in the running app as a direct rail tab beside the main conversation
- [x] 4.4 Commit the completed redesign on the local `develop` branch

## 5. Real-app usability follow-up

- [x] 5.1 Use the active thread workspace consistently for contribution discovery, visibility, commands, View Sessions, and extension panel rendering
- [x] 5.2 Supply the admitted active/trusted SDK workspace context whenever a workspace-scoped View activates or reactivates its Node Host
- [x] 5.3 Make video-editor theme and locale initialization independent from project/runtime requests, retain live Kun setting updates, and translate all visible reference-editor copy
- [x] 5.4 Add renderer, runtime, and video Webview regressions for workspace alignment, View activation context, failed initialization, and live locale switching
- [x] 5.5 Align the Desktop Host and Kun Runtime guest-safe View policies so permitted jobs and brokered-media methods work from the sandboxed editor
- [x] 5.6 Run focused and repository-wide validation, verify the panel in the running app in Chinese and English, and commit the follow-up on local `develop`

## 6. Workspace isolation and Agent synchronization

- [x] 6.1 Scope workspace extension Hosts and registered tools by normalized workspace ownership; fail closed on activation mismatch and add two-workspace discovery/invocation regressions
- [x] 6.2 Scope View event publication by workspace and add two-workspace delivery regressions
- [x] 6.3 Make the workspace active-project pointer authoritative for View startup and Agent-originated selection, add race-safe View loading, and clear/filter stale project resources
- [x] 6.4 Split read-only render status from side-effecting cancellation and update the tool catalog, Agent profile, and approval tests

## 7. Executable video workflow

- [x] 7.1 Fix FFmpeg duration, safe binding labels, canvas/transform geometry, and bounded 30-plus-clip composition; add real proof/preview/H.264 execution regressions
- [x] 7.2 Add capability preflight for FFmpeg, ffprobe, encoders, and optional caption filters with localized supported fallback guidance
- [x] 7.3 Add the public bounded UTF-8 media text-read API and complete panel-driven SRT, VTT, and transcript JSON import with handle cleanup
- [x] 7.4 Make the player timeline-aware across trims, speed, ordering, cuts, asset changes, and captions; make deterministic script review read-only and expose explicit parse errors
- [x] 7.5 Make project projection, switching, corrupt-project discovery, jobs, artifacts, proof caption mode, media recovery, and result previews project-aware and recoverable
- [x] 7.6 Add FPS selection and supported standalone sidecar subtitle export so documented editor controls match implemented workflows

## 8. Generic localization and reference-example delivery

- [x] 8.1 Add validated generic manifest locale overlays to Extension API schema, CLI, Runtime contracts, and Host resolution
- [x] 8.2 Localize the bundled video extension's Host-rendered title, tooltip, Extension Center metadata, settings, errors, and result-preview copy in English and Simplified Chinese
- [x] 8.3 Make repository-local example scripts location-safe, distinguish repository and public-registry setup, and update SDK/example documentation
- [x] 8.4 Add a real bundled Video View desktop E2E covering locale/theme, project creation, media/transcript import, edit, proof/export, Agent synchronization, and reopen recovery
- [x] 8.5 Bump the bundled video extension version, regenerate deterministic `.kunx` and catalog/release fixtures, and surface seed/permission-upgrade diagnostics in Extension Center

## 9. Final verification and delivery

- [x] 9.1 Run focused API, Runtime, renderer, Webview, FFmpeg integration, package, and release-gate suites
- [x] 9.2 Run repository typecheck, lint, test, build, OpenSpec validation, and dirty-artifact checks
- [x] 9.3 Exercise a real media file through import, cuts, transcript/captions, Agent edit/status, proof, export, close/reopen, and Chinese/English switching in the running Kun app
- [x] 9.4 Commit the completed usability repair on the local `develop` branch
