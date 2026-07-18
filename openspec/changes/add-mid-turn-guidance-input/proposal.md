## Why

Messages submitted while an agent turn is running are currently held until the whole turn finishes and then sent as a separate turn. Users need an explicit way to steer the running agent so an appended instruction is incorporated at the next safe LLM boundary, with a pending-input presentation that makes the choice visible and reversible.

## What Changes

- Redesign pending composer messages as compact rows above the composer, matching the supplied interaction reference and preserving remove controls.
- Add a per-message **Guide** action that submits an eligible text-only pending message to the active Kun turn instead of waiting to create a later turn.
- Keep the message queued when guidance cannot be accepted, so a completion race or unsupported payload never loses user input.
- Make the native Kun loop continue to another model request when guidance arrives during a model response that would otherwise finish the turn.
- Add localized labels, accessibility states, and focused renderer/runtime tests for the new behavior.

## Capabilities

### New Capabilities

- `mid-turn-guidance`: Pending text input can be explicitly injected into a running Kun turn at the next safe LLM interaction.

### Modified Capabilities

None.

## Impact

- Renderer composer presentation and Zustand chat actions under `src/renderer/src`.
- Existing Kun runtime provider `steer` request mapping; no new IPC or HTTP endpoint.
- Kun steering queue and native agent-loop terminal-boundary behavior under `kun/src/loop`.
- English and Chinese composer localization and focused Vitest coverage.
