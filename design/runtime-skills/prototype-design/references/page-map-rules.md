# PageMap Rules

## Scope pages from the requirement

- Create the smallest page set that covers the confirmed user journeys and acceptance intent.
- Give each page one clear responsibility. Split a page only when the requirement describes a distinct destination, a separately navigable task, or a materially different context.
- Keep transient UI conditions such as loading, validation, empty data, expanded panels, and overlays in `states` unless the requirement makes them separate navigable destinations.
- Do not add speculative settings, administration, onboarding, marketing, or error pages.

## Keep identity and paths safe

- Make every `pageId`, `actionId`, `scenarioId`, and `flowId` unique, stable, concise, and descriptive.
- Set `entryPageId` to a declared page. The primary flow starts there.
- Use a relative HTML `filePath` for every page. Keep paths unique and use only safe path segments; never emit absolute paths, parent traversal, URLs, query strings, or fragments.
- Use the supplied schema version and requested PageMap version exactly.

## Build a complete route graph

- Point `targetPageId` only to a declared page. Omit it for actions whose outcome is entirely local to the current page.
- Describe `trigger` as an observable user action and `outcome` as the resulting state or navigation, not implementation detail.
- Include actions needed by the confirmed flows and obvious return navigation. Do not invent actions merely to make every component interactive.
- Make every flow an ordered, executable journey. Every non-final step names an action from that step's page. A final step may omit `actionId`.
- For a cross-page step, the action's `targetPageId` must equal the next step's `pageId`. For a same-page step, a local action may omit `targetPageId`; when it declares a target, that target must still equal the next step's page.
- Ensure each declared page is reachable from `entryPageId` through persistent `sharedShell.navigation` or action `targetPageId` edges. Appearing in a flow never makes a page reachable by itself.
- Avoid orphan pages and dead-end destinations unless the requirement explicitly calls for a terminal success state.

## Define shared structure deliberately

- Put only declared page IDs exposed by persistent cross-page navigation in `sharedShell.navigation`.
- Put a key in `sharedShell.sharedStateKeys` only when multiple pages depend on the same simulated state. Repeat on each consuming page only the keys it actually uses.
- Keep shared navigation, naming, and state semantics consistent across pages. Pages in the same task or state family must preserve the same shell.

## Make acceptance executable

- Give every page at least one concrete acceptance scenario.
- Write scenarios as observable `given` / `when` / `then` behavior. Cover the page purpose, required actions, important states, and the expected destination or feedback.
- Use business-realistic sample behavior without inventing backend guarantees or quantified claims.
- Before returning JSON, verify uniqueness, entry-page existence, path safety, target validity, flow/action consistency, reachability, and scenario coverage.
