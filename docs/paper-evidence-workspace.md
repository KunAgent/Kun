# Trustworthy paper reading and evidence workspace

This is an incremental implementation of the three-stage paper-mode plan. It
extends the existing paper library, PDF reader, annotations, research sessions,
comparison/Related Work actions, and Kun runtime. A paper ID appearing in search
results confirms only its identity in that retrieval session, not the truth of
its claims, the completeness of its text, or the correctness of its experiments.

## Stage 1: trustworthy close reading and comparison

The acceptance boundary is a usable vertical workflow: open an existing paper,
inspect material limitations, save an annotation as version-bound evidence,
record a separate interpretation and verification decision, compare selected
papers without filling unknowns, and reopen the workspace without losing edits.

- Preserve canonical identity and the actual read version independently. Never
  infer an arXiv revision from an unversioned URL. Fingerprint PDFs on demand,
  not by hashing every library PDF during startup. Existing paper.json schemas,
  BibTeX keys and annotation files remain readable.
- Original quotes are immutable evidence snapshots. Editable interpretation,
  conditions, research question and claim kind are distinct fields. A program
  can check a locator and quote; it cannot certify semantic support. Manual
  verification is a separate, explicit user decision. Legacy marks with no
  version binding remain labeled unbound, and replaced PDFs never silently
  remap old evidence to a new page.
- Reading purpose distinguishes quick screening, method deep reading,
  reproduction preparation and review critique. Research goals and background
  are optional. Material status must distinguish metadata/abstract-only,
  extracted text, missing/unreadable pages and figure confidence; a successful
  extraction is not proof that a paper or its claims are complete or correct.
  Preserve original symbols, units, negation and qualifiers. Quick screening
  does not require whiteboards. Foundation/glossary material is conditional.
- Comparison matrices persist selected papers, axes, evidence references,
  manual cells and comparability decisions. Empty cells are “not reported”,
  never invented. Adding papers does not regenerate existing user decisions.
  Dataset versions, splits, model size, training resources, metrics, conditions,
  code and limitations can differ; an apparent numeric ranking is not proof
  that evaluations are comparable.
- PDF reading, notes/evidence and chat use switchable existing surfaces. Search
  and candidates stay in exploration; comparison is synthesis. Existing paper
  directories and IDs are shared; the workspace never duplicates the PDF.
- Scoped reading uses the existing Runtime and approval path. Visible policy
  must match enforcement: read-only Q&A, explicit material scope, tool/download/
  delegation restrictions, provider disclosure and bounded model calls. A
  local-only label must include the model connection, not just tool access.
  Paper text is untrusted reference material, never instructions. Stop retains
  intermediate chat/evidence. Existing-file AI edits require a reviewable diff
  and undo; a prompt saying “do not edit” is not an access boundary.

Implementation status and exact checks are recorded in the PR. Anything not
implemented there is a remaining Stage 1 requirement, not silently assigned to
Stage 2 or described as already supported.

## Stage 2: durable research projects and reproducible retrieval

Not implemented by the first evidence-workspace slice:

- Lightweight project questions, scope, papers, evidence, hypotheses, matrices
  and next tasks. Inclusion/exclusion decisions are independent of read status.
- Search snapshots retain query, sources, filters, time, results, failure and
  deduplication decisions; title/abstract and full-text screening are separate.
  Historic decisions survive model and search-provider changes.
- Evidence-linked citation drafting with reviewable changes to existing prose.
  Reliable BibTeX keys, import conflict handling, attachments and incremental
  exports; explicit relationships between paper/PDF versions and version diffs.
- Optional Zotero and Overleaf interoperability after conflict/version rules
  are defined. No assumption that two matching titles mean the same version.

## Stage 3: bounded reproduction and research maintenance

Not implemented by the first evidence-workspace slice:

- A selected claim yields a bounded reproduction plan with pinned code/data,
  environment, commands, hardware, expected result and missing parameters.
- User approval precedes isolated Code workspace execution, unknown code,
  downloads and cost commitments. Run evidence records commit, config, seed,
  logs, artifacts and failed attempts. “Code executed”, “settings aligned” and
  “result replicated” remain distinct statements.
- Project-aware updates and retractions retain source and check time. Absence
  of a warning is never a verification badge.
- No early team administration, complex graph or full submission platform.

## Research example and success criteria

For small-model code search: state the question, collect candidate sources,
record inclusion reasons, save version-bound evidence, compare incompatible
benchmarks explicitly, propose a minimal experiment, then draft Related Work
with traceable evidence. Success means easy source inspection, less manual
comparison rework, and durable continuation after reopening. Generated word
count is not a success metric.

## Verification requirements

Unit/integration tests cover corrupt persistence, stale anchors, missing PDFs,
partial text, unknown cells, concurrent/double actions, manual edit preservation
and privacy/context enforcement. Native UI smoke must exercise real renderer
components and produce actual screenshots, including narrow layouts, errors,
reopening and canceled dialogs. Offline deterministic fixtures make no paid
model calls, use no real credentials and transmit no private paper data.

## First PR: implemented boundary and remaining Stage 1 work

Implemented in this slice:

- Local, file-backed evidence cards and matrices, IPC/preload/UI entry points,
  explicit manual semantic review, immutable quotations/image snapshots,
  per-PDF byte identity and stale-source refusal
- Matrix cell editing with evidence references, explicit unknown/comparability
  states, incremental rows/axes, manual-edit preservation and last-edit undo
- Purpose dialog, material/figure limitations, optional background/goal,
  selected-passage/current-paper/multi-paper frozen text, and existing
  compare/Related Work actions routed to a read-only chat draft
- A native HTTP model route with one durable request budget and one physical
  HTTP attempt. No agent tools, delegation, downloads, memory/history expansion,
  hooks, title calls, SDK harnesses or automatic model routing in these turns.
  Passive Markdown rendering keeps model-supplied images, links and HTML inert
  without losing document structure. Interrupted answers remain in the existing
  thread, and their rendering policy survives streaming and reopening.
- No model-generated writes to existing notes or matrices. Local manual edits
  have save/undo; copied evidence/matrix Markdown can be used in existing notes.
  Existing general editing remains a separate explicit workflow.

Still Stage 1, not claimed complete or silently moved to Stage 2:

- Supported local-model inference transport. The local-only choice currently
  allows local evidence/matrix work and sends no AI request; inference fails
  closed. These controls apply to the explicit reading request, not a global
  offline setting; existing search and translation retain their own settings. Fixed configured native HTTP providers are the only scoped-AI route.
- Chunked close reading above the 80,000-character frozen-context cap. Quick
  screening discloses truncation; deeper reading is blocked on partial text.
  Up to 12 selected papers fit a bounded synthesis request; oversized requests
  require a smaller selection rather than silently dropping sources.
- Multimodal scoped inference. Image evidence is retained and viewable locally;
  the region discussion action sends only the explicitly labeled annotation
  text after confirmation, not the image. Figure extraction confidence is
  visible but old figure indexes do not have a verified PDF-version binding.
- Automatic claim-to-evidence extraction and reviewable AI edits/diffs in
  existing notes/drafts. Current evidence starts from user-selected highlights
  or image annotations, and generated answers remain unverified prose.
  Paper answers support passive Markdown tables, lists, code and local math;
  raw HTML, resource loading and interactive links/file actions stay disabled.
  Source inspection is provided by evidence cards; generated prose does not
  automatically become a clickable, source-verified claim.
- Project-scope context and project-level budgets depend on Stage 2's project
  model. This slice exposes passage, paper and explicit selected-paper scopes.
  It bounds calls but does not invent currency-cost estimates.
- Manual external directory moves need explicit re-linking; the app must not
  guess identity by title or silently remap an unknown old annotation version.

Metadata-loading and navigation guards are fail-closed: recognized paper Q&A,
inline chat actions and selected-passage asks cannot fall back to generic agent
submission while library metadata is absent. Pending selections retain their
capture-time workspace, unit and PDF hash; changed or unavailable identities
require a new selection rather than relabeling old text with new PDF bytes.
