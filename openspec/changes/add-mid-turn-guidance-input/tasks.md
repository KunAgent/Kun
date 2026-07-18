## 1. Runtime Steering Handoff

- [x] 1.1 Add terminal sealing semantics and focused race/cleanup coverage to `SteeringQueue`.
- [x] 1.2 Make the native agent loop continue after a final response when steering is pending, and seal delegated/non-guidable boundaries before completion.
- [x] 1.3 Add an agent-loop test proving guidance accepted during a final streamed response appears in the next model request.

## 2. Renderer Guidance Action

- [x] 2.1 Extend the runtime provider mapping to preserve optional display text on steer requests.
- [x] 2.2 Add queued-message eligibility checks and a store action that guides the active turn, removes only accepted messages, and preserves failures.
- [x] 2.3 Wire the guidance action from the chat store through the Workbench composer props.

## 3. Pending Input UX

- [x] 3.1 Redesign queued messages as compact pending rows with Guide, pending, disabled, and Remove states.
- [x] 3.2 Add English and Chinese labels, hints, errors, and accessibility text for mid-turn guidance.
- [x] 3.3 Add focused component/store/provider tests for eligible, ineligible, successful, and failed guidance.

## 4. Validation

- [x] 4.1 Run focused Kun and renderer Vitest suites for steering, runtime mapping, store actions, and composer presentation.
- [x] 4.2 Run `npm run typecheck`, `npm run build:kun`, and `git diff --check`; separate any baseline failures from regressions.
- [x] 4.3 Review the final diff for scope, preserve unrelated dirty files, and update all OpenSpec task statuses.
