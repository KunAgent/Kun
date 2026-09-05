## 1. Projection and Contracts

- [x] 1.1 Add trajectory schema-v2 record/request/detail fields and renderer v1-to-v2 normalization.
- [x] 1.2 Rebuild the query projection for merged Assistant, Tool, Context, Compacted, System, request-boundary, and real Subtool records.
- [x] 1.3 Scope rich detail resolution to the selected request/record and expose Prompt fingerprints, options, usage, timing, schema, source, attachments, and diff inputs.

## 2. Harness Renderer Port

- [x] 2.1 Port pure layout, search, request numbering, timeline model, and virtual-row algorithms from the frozen Harness commit.
- [x] 2.2 Replace the toolbar and timeline with Harness geometry and full duration/range/zoom/pan/tooltip behavior.
- [x] 2.3 Replace Turn cards with the Harness two-column dense table, request boundaries, rails, inline results, fold states, paging, tail follow, and virtualization.
- [x] 2.4 Replace the generic inspector with record-specific Markdown, JSON/Schema, image, source, usage/options/timing, and Prompt Diff presenters.
- [x] 2.5 Add Harness responsive behavior, semantic Kun token bridge, keyboard/ARIA/reduced-motion semantics, and all-locale copy.
- [x] 2.6 Float the existing Composer over trajectory and publish measured bottom clearance without unmounting Chat or Composer.

## 3. Verification

- [x] 3.1 Port reference-derived projection, layout, timeline, virtualization, inspector, and interaction tests.
- [x] 3.2 Add a deterministic Electron trajectory layout smoke and screenshot/geometry evidence for parity states and breakpoints.
- [x] 3.3 Update trajectory documentation and record MIT reference commit/source attribution.
- [x] 3.4 Run focused tests, typecheck, Kun build, production build, changed-file ESLint, file-line, OpenSpec, and diff checks; separate baseline failures.
- [x] 3.5 Commit, rebase onto latest local develop, resolve/retest conflicts, fast-forward merge, and remove the worktree/branch after containment proof.

## 4. Raw and Source Inspector Parity Follow-up

- [x] 4.1 Split trajectory Raw content blocks from allowlisted Source provenance in the on-demand detail projection, including legacy-safe and sensitive-data behavior.
- [x] 4.2 Add DSH-style ordered Raw block and compact Source JSON-tree presenters, with Source-tab availability derived from real provenance.
- [x] 4.3 Cover Raw/Source projection, redaction, compatibility, keyboard/copy interaction, and deterministic inspector rendering with focused tests and smoke evidence.
- [x] 4.4 Run the scoped and repository validation gates, commit, rebase onto latest local develop, fast-forward merge, and remove the temporary worktree/branch after containment proof.
