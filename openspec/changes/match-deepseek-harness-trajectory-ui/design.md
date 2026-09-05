## Context

Kun currently renders trajectory data as a dashboard with a 48px combined title/filter toolbar, summary metrics, an 88px timeline, 44/62px card rows, and a generic JSON inspector. DeepSeek Harness `packages/client/ui-trajectory` at `0a53fb55bea101816fa226bb964ae2bed71c343b` instead renders a 32px toolbar, 50px timing overview, dense two-column 30px ledger, request-boundary markers, and record-specific rich inspection. Kun already has compact request metadata, Prompt Manifests, Session items, attachment rendering, virtualization, and the title-bar Trace entry.

## Goals / Non-Goals

**Goals:**

- Match the frozen Harness trajectory geometry, hierarchy, responsive behavior, keyboard/ARIA semantics, and interaction model.
- Preserve Kun's title-bar entry, semantic theme tokens, storage/capture policy, route paths, and chat/composer state.
- Upgrade trajectory projection/detail data only where required for the reference ledger and inspector.
- Port reference algorithms and tests under Kun's 700-line file limit.

**Non-Goals:**

- Copying Harness global navigation, Chat/Trajectory tabs, Cordis slot runtime, or design-token package.
- Linking to the Harness checkout at runtime or changing compact storage formats/budgets.
- Literal Harness colors in custom Kun themes.

## Decisions

### Port behavior, adapt integration

Port the MIT trajectory layout, timeline, virtual-row, table, inspector, and CSS behavior into Kun-owned modules. Replace Harness Session/slot inputs with a pure adapter over Kun trajectory schema v2. This retains the tested interaction model without importing its application architecture.

### Use a dense renderer model

The renderer normalizes v1/v2 pages into System/User/Context/Compacted/Assistant/Tool/Subtool cells and request-boundary records. Request records do not render duplicate rows; they number and decorate the matching Assistant or a separator-only anchor. Assistant reasoning/text and Tool call/result are folded before rendering.

### Extend query detail without migrating storage

Schema v2 adds prompt fingerprints, parent relationships, source/detail availability, attachments, request options, and precise record-scoped references. Existing journals/manifests remain unchanged; the query service derives v2 and the renderer continues accepting v1.

### Match reference geometry through CSS modules

Port exact dimensions and structure into CSS modules, with a small semantic token bridge from Harness aliases to Kun variables. Remove the current summary/filter surfaces. The floating composer publishes its measured height and ledger/detail scrollers reserve that height plus 16px.

### Preserve reference interaction invariants

Use local loaded-window search, separate Turn/Call folds, synchronized table/timeline selection, sequence/duration/time projections, range drag, wheel zoom, right-button clear/pan, edge pan, delayed tooltips, tail following, stable prepend anchors, and Harness virtual row heights.

### Provide record-specific inspection

System rows expose Prompt/Tools/Diff; Requests expose Summary/Options/Usage/Timing; Markdown records expose Summary/Preview/Raw/Source; Tool records expose Summary/Payload/Result/Schema/Timing. Reuse Kun Markdown/media components and add local JSON/Schema tree and copy primitives.

## Risks / Trade-offs

- [Reference monoliths exceed Kun line limits] → Split pure models, gestures, rows, presenters, and styles while preserving reference tests and constants.
- [Kun lacks some Harness event kinds] → Render System/Subtool only from real Prompt Manifest or nested runtime evidence; never synthesize fake records.
- [Theme mapping prevents literal color equality] → Gate exact geometry and semantic state mapping; use pixel comparison for default Kun light theme and structural assertions for other themes.
- [Rich detail can trigger repeated large reads] → Fetch sections lazily, cache by record/section, and keep existing capture/eviction states.
- [Composer overlay can hide final rows] → Publish the live composer height through ResizeObserver and use it in both ledger and inspector bottom padding.

## Migration Plan

1. Add schema-v2 projection/detail fields and v1 normalization.
2. Introduce pure renderer models and port reference behavior tests.
3. Replace toolbar/timeline/ledger/inspector and composer layout.
4. Add localized copy and Electron screenshot smoke.
5. Keep the old v1 parser for rollback; no disk migration is required.

## Open Questions

None. Entry placement, full interaction parity, theme mapping, and frozen reference commit are fixed.
