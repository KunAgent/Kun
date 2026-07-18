## Why

Kun currently exposes extension UI through a host-level launcher that mixes several placement models and makes an extension feel detached from the native right-side tools. Extensions need one clear, self-registering entry point where their declared icon opens their own panel beside the main Agent, so users can work with the Agent and extension UI at the same time.

## What Changes

- Make `views.rightSidebar` the canonical discoverable extension UI: every visible contribution registers a direct icon in Code mode's vertical right rail that opens its own isolated top-level tab.
- Remove the aggregate extension-view launcher from the workbench rail. Existing non-right View contribution schemas remain accepted for Extension API v1 compatibility, but Kun no longer presents them as the default extension navigation model.
- Keep the Host responsible for ordering, selection, panel sizing, focus, trust, permissions, session isolation, and fallback icons; an extension supplies only bounded declarative metadata and its sandboxed Webview.
- Define a shared-workspace coordination model in which a main Kun Agent and an open extension panel use the extension's registered tools and workspace-scoped state rather than private renderer imports or cross-Webview DOM access.
- Convert the bundled Kun Video Editor from a full-page contribution into a self-registered right-sidebar video workbench with a packaged icon, a useful docked layout, and the existing video tools as the Agent-facing control plane.
- Update the reference documentation and tests so third-party authors can use the bundled video editor as the canonical right-sidebar extension example.
- Close the real-media usability and isolation gaps discovered in desktop verification: workspace-owned Hosts/tools/events, executable FFmpeg plans for long edited timelines, transcript import, authoritative Agent/project synchronization, generic Host-chrome localization, and an end-to-end packaged View gate.

## Capabilities

### New Capabilities

- `extension-right-sidebar-navigation`: Direct extension rail icons and isolated tabs in Kun's Code right workspace, including ordering, selection, lifecycle, compatibility, and removal of aggregate launchers.
- `extension-agent-panel-coordination`: Workspace-scoped coordination between the main Agent, extension tools, and an open extension panel without exposing renderer internals.
- `kun-video-editor-sidebar`: A docked Kun Video Editor panel that shares project revisions with the main Agent through the public extension tool and event surfaces.

### Modified Capabilities

None. The negotiated Extension API v1 schemas for existing non-right View locations remain compatible; this change narrows the recommended and host-discoverable extension UX without removing those manifest fields.

## Impact

- Renderer workbench contribution routing, right-workspace tab state, panel sizing, and extension View session rendering.
- `@kun/extension-api` documentation and example guidance for UI contribution placement; no new privileged renderer bridge is introduced.
- Public manifest localization and a bounded opaque-handle text-read method, both enforced by the existing broker and permission model.
- The bundled `examples/extensions/kun-video-editor` manifest, Webview responsive layout, icon assets, Agent/tool coordination, packaging identity, and release fixtures.
- Workspace-scoped Extension Host/tool/event ownership, Extension workbench tests, executable video integration tests, real packaged View smoke, public documentation, OpenSpec verification, and local `develop` migration behavior.
