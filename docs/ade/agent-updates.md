# Native Agent updates

Kun reports the executable it actually launches, including its version and owner.
A newer binary on PATH is a candidate, not evidence that the running Agent has
already been upgraded. Update checks only inspect version and release metadata;
they never install software or send a model prompt.

## Installation ownership

- Kun-bundled and other application-bundled executables remain owned by their
  application. Kun offers the owning application's update guidance or a separate
  managed installation; it does not overwrite signed application contents.
- A newer local Claude Code or Codex installation can be verified and selected.
- npm and Homebrew installations use their original prefix or cask. Recognized
  native installers use the selected executable's documented update command.
- Managed npm installations are staged in a versioned directory. The previous
  executable remains available for rollback during the runtime session.
- Custom launchers require manual maintenance unless an official managed
  alternative is available. Exact-version runtimes keep their compatibility pin.

## Activation

An update request binds to the executable fingerprint the user reviewed. New
turns for that Agent are rejected with a retry message during maintenance; admitted turns
finish normally. Installation and prompt-free protocol/account verification
precede the settings change. Main confirms settings synchronization, then the
runtime verifies the active executable identity and rechecks the enabled profile.
A failed activation restores the previous effective path and releases maintenance
only after settings synchronization. Cancelling an in-place external installer
cannot undo changes that installer already made.

Model probes and idle process pools include executable identity, so replacement
at the same path invalidates old results. Compatible Codex upgrades retain the
native session binding; account, workspace, route and history checks still apply.

## Discovery and user interface

The desktop caches successful release checks for 24 hours and unavailable checks
for 5 minutes. Users can check manually, defer a notice or ignore the advertised
version. The Agent settings card shows source, version, update progress and
installation details. Native model menus show catalog provenance and refresh
controls. A refreshed catalog never silently replaces the user's selected model.
Updating a client does not change account entitlement or guarantee model access.

Tests cover installation classification, executable replacement, maintenance
admission, activation fencing, cancellation, rollback, cache invalidation and
HTTP/IPC boundaries. An installed local Claude Code can exercise the complete
metadata-only verify/switch/refresh/rollback path without an inference request.
