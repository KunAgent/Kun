## Why

Kun's automated desktop and settings-migration tests can invoke the real operating-system credential facility. On macOS, isolated test homes have no default Keychain, so `security add-generic-password` opens a blocking system dialog and can place test material in a developer's real Keychain if the default is restored.

## What Changes

- Add an explicit non-interactive environment override that forces the authenticated encrypted key-file fallback without executing an operating-system credential helper.
- Enable that override in Vitest and in isolated desktop smoke processes, including their managed Kun runtime, so automated runs cannot open Keychain UI or touch a developer's real credentials.
- Cover override precedence, command suppression, fallback persistence, and smoke-environment propagation with hermetic tests.
- Preserve the production default: normal application launches continue to prefer the operating-system credential facility when it is available.

## Capabilities

### New Capabilities

- `credential-store-isolation`: Defines non-interactive credential-store selection, explicit automation isolation, encrypted fallback behavior, and production OS-store preference.

### Modified Capabilities

None.

## Impact

- Kun security key-provider selection.
- Top-level and Kun Vitest environments.
- Shared packaged/development desktop smoke environments and their contract tests.
- Unit coverage for fallback selection, command suppression, and migration isolation.
