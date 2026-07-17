# Lightweight Manuscript Quality Gate

Use this before claiming a draft, chapter, or delivery artifact is good enough
for the next stage.

## Layers

| Layer | Weight | Checks |
| --- | --- |
| S | 20 | concrete opening, redundant wording, long sentences, transition overuse, generic buzzwords, punctuation discipline |
| P | 20 | problem-driven paragraphs, evidence or quotes, no decorative symmetry, no filler paragraphs |
| C | 20 | chapter stance, prior-chapter bridge, next-chapter hook, action-oriented ending, varied structure, specific data or source boundaries |
| B | 20 | heading uniqueness, non-formulaic titles, rhythm variance, punctuation variety, repeated structure |
| G | required | facts, copyright, user constraints, professional red lines |

## Chapter Continuity Check

For multi-chapter manuscripts, every chapter-level review should explicitly
answer four questions:

- Does this chapter inherit the promise, problem, or unresolved thread from the
  previous chapter?
- Does the chapter introduce a distinct job instead of repeating the previous
  chapter in different words?
- Does the ending point to the next chapter, next decision, or next source gap?
- Are continuity gaps marked as `needs_bridge` rather than hidden under a
  generic style pass?

Use `needs_bridge` when the chapter is locally readable but would feel abrupt
inside the whole manuscript.

## Pass Rule

- `pass`: overall quality is acceptable and all G gates are green.
- `weak_pass`: useful enough to continue, but one or more non-G issues should
  be fixed before final delivery.
- `fail`: a G gate is red, the draft contradicts user constraints, or the
  structure is too weak to continue safely.
- If key facts still depend on external verification, mark the affected claim
  state as `unverified` or `blocked_external` instead of hiding it inside a
  generic style pass.

Never report a draft as final-quality if a G gate is red. If the available
material is not enough to evaluate a G gate, mark it as `needs_review`.

## First-Value Shortcut

For first value, do not run a long audit. Return a compact quality summary:

- strongest usable part
- highest-risk missing material
- one style or structure issue to fix next
- whether the next branch should be drafting, revision, or finishing

## Finishing Gate

Before format/export or delivery, check:

- heading hierarchy and numbering
- title page or opening block
- table and figure placeholders
- repeated empty sections
- style and terminology consistency
- unsupported facts or claims
