# Post-Draft Finishing Pack

Use this when the user already has a draft and needs the last mile of delivery
instead of another outline.

## Trigger

- layout, export, format cleanup, or Word/PDF readiness
- de-AI polish, tone repair, or style cleanup
- rewrite, localization, translation cleanup, or audience adaptation

## Minimum Chain

1. Confirm the input draft and target format.
2. Run a lightweight quality read: structure, evidence gaps, tone, and obvious
   repetition.
3. Run a layout/export precheck: title page, table of contents, headings,
   blank lines, tables, figure placeholders, and output format.
4. If de-AI polish or rewrite is requested, produce a before/after delta and
   explain what changed in tone, specificity, and rhythm.
5. Return a result card with the next branch: `format_export`,
   `de_ai_polish`, `rewrite_localize`, `revise_structure`, or
   `save_handoff`.

## Degrade Rules

- If a binary document has no editable companion text, only do file-level and
  visual precheck. Do not invent a full text diff.
- If there is no rewritten draft, output quality and layout findings first.
  Do not fabricate a de-AI comparison.
- If service tools are unavailable, keep the action envelope read-only and
  preserve the next branch for a later same-binding continuation.

## Regression Fixtures

Use the package fixtures as reviewer-safe samples:

- `fixtures/post-draft/sample-before.md`
- `fixtures/post-draft/sample-after.md`
- `fixtures/post-draft/sample-layout.md`
