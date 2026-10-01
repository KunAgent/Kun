# Personal Agent to Code Agent handoff

A private Agent conversation can discover the execution engines already configured
in Code and propose a task for one of them. This extends the existing
`workbench_link` bridge; it does not add another runtime or task queue.

## Route and authority

- `list_code_harnesses` reads the shared harness catalog, detector, model connection
  registry and admission router. Native model discovery uses the same cached,
  prompt-free probes as the Code picker, including on a cold start. The bounded
  output contains usable model routes and unavailable reasons, never commands,
  credential values or secret references.
- `create_code_task.execution.model` selects `harnessId`, `credentialMode`, `model`
  and, for a provider-backed route, `providerId`. Native sign-in does not need a
  fabricated provider. The selected route is checked and persisted before a card
  can start; it is rechecked at confirmation and execution admission.
- The model cannot set task permissions or a persona. The existing Agent Code
  policy controls confirmation, and the private conversation's execution policy
  remains an upper bound at admission. Selecting another Agent cannot widen it.
- Discovery is cancelled with its conversation turn and has a 20-second overall
  wait budget. External model probes are skipped when routing is disabled.
- Unavailable or disabled engines fail explicitly. They never silently run on
  Kun or another engine. The existing shared Code admission gate currently treats
  a detected signed-out engine as unavailable even with a provider/gateway route;
  this bridge does not bypass that gate. Terminal-only agents do not host delegated turns.
- External engines currently support direct Code tasks. Kun owns plan, automatic
  plan/build, goal and Graph execution. Work retains its scoped model restrictions.

## Conversation experience

A task card keeps its execution Agent, native/provider source and model visible
from proposal through completion. Editing uses the shared Code Agent picker and
model discovery caches, with a local draft; it never changes the active Code
composer. Cancelling edits discards the local draft. An incomplete model route
cannot be confirmed, and incompatible Kun-only modes are disabled for external
Agents.

Tasks use ordinary Code threads and turns. Existing link reconciliation provides
progress, attention/approval, stop, open-in-Code and final results. The outcome
returned to the personal Agent includes the actual persisted execution route.

## Verification

Focused tests cover catalog discovery, native/provider/gateway selection, missing
or disabled engines, exact routing, confirmation, permission ceilings, cancellation,
results, Work isolation, local UI selection and edit cancellation.

`node scripts/smoke-development-ade.cjs --rooms-harness-only` runs the real Electron,
preload, main and Kun composition with an isolated profile and deterministic offline
model/ACP subprocess fixtures. It records the proposal, shared Agent picker,
execution options, progress and result at desktop widths in light/dark themes.
The dedicated PR workflow uploads PNGs and a verification report. These are real
rendered UI evidence, not tests of a paid provider account or production deployment.
