# Computer Use CUA Driver compatibility

Kun uses CUA Driver `0.22.2` (`contractVersion` `0.7.0`) as the Electron
Main-process backend for the existing `computer_use` tool. CUA is a driver,
not a second agent runtime: Kun continues to own model calls, approvals,
threads, HTTP/SSE events, budgets, and tool results.

## Supply chain

`@trycua/cua-driver@0.22.2` declares exact optional native packages for:

- macOS x64 and arm64
- Windows x64 and arm64
- Linux glibc x64 and arm64

It also pins `@ubjs/core` and `@ubjs/node` to `0.31.0-3`. The package is MIT
licensed; attribution is included in `THIRD_PARTY_NOTICES.md`. Electron Builder
keeps `@trycua/*` and `@ubjs/*` outside ASAR so the native library and Node
runtime can be loaded by Electron Main.

## Runtime boundary

- Electron Main lazily creates `CuaDriver.createConfigured()` in Standard mode.
- Unrestricted mode, capability-manifest paths, TTLs, and arbitrary CUA tool
  names are never accepted from model arguments.
- The GUI-owned authenticated loopback bridge remains the only Kun runtime
  entry point. Bridge contract v2 carries session/frame context while v1 is
  accepted temporarily for migration.
- Actions are globally single-flight. A failed side-effect is never replayed
  through a legacy backend.
- Shutdown closes bridge admission before awaiting CUA shutdown.

## Action compatibility

| Kun action | CUA operation | Notes |
| --- | --- | --- |
| screenshot | getDesktopState | PNG is bounded and downscaled for model input |
| cursor_position | getCursorPosition | converted to latest frame coordinates |
| mouse_move | moveCursor | frame coordinate is resolved to native desktop |
| click/double_click | click | exact button and count preserved |
| left_click_drag | drag | both points must use one live frame |
| scroll | scroll | line mode, bounded amount |
| type | typeText | text is never included in activity metadata |
| key | pressKey/hotkey | known modifiers are split from the key |
| wait | Kun timer | abortable; screenshot follows |

CUA `0.22.2` does not expose modifier-click in its portable ClickInput. Kun
fails closed with `unsupported_modifier_click`; it never drops modifiers or
replays the click on another backend.

## Coordinate and privacy rules

Each screenshot receives a random frame ID and a hashed, content-free session
label derived from Kun thread/turn IDs. Coordinates are valid only for that
session and frame. Frames expire after 30 seconds; expired, cross-session, and
out-of-bounds coordinates return `stale_frame` and require a new screenshot.
Only bounded allow-listed structured fields are projected from CUA results;
`rawJson`, screenshots, typed text, clipboard contents, and bridge tokens are
not logged by the adapter.

## Verification status

The repository verifies frame mapping, frame expiry, v1/v2 bridge migration,
authenticated routing, tool result framing, and structured error propagation in
unit/integration tests. Native fixture and signed/notarized packaged-app checks
remain platform release gates; support must not be inferred from npm package
availability alone. Wayland behavior is compositor-specific and exact CUA
refusals are preserved rather than reported as success.
