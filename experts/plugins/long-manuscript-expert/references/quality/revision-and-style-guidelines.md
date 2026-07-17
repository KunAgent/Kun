# Revision and Style Guidelines

Use these guidelines when turning an outline, transcript, old draft, or AI-like
paragraph into a more durable manuscript section.

## Revision Rules

- Preserve the user's intent before changing tone.
- Replace generic transitions with concrete causal, chronological, or decision
  links.
- Prefer specific nouns, actors, and constraints over abstract claims.
- Keep one main job per paragraph; split paragraphs that mix premise, proof,
  and conclusion.
- When rewriting for local style, explain what was preserved, rewritten,
  removed, and left for verification.

## De-AI Polish

For de-AI polishing, check these signs:

- formulaic openers such as "First", "It is worth noting", or "In conclusion"
- symmetrical paragraph shapes with no actual progression
- broad claims without source boundaries
- empty intensifiers such as "high-quality development" without examples
- endings that summarize without creating a next action

Use a stronger sample when the before/after pair only shows light editing. The
test fixture `fixtures/post-draft/sample-heavy-ai-before.md` is the preferred
stress case for this path.

## Delivery Boundary

Do not claim final quality when facts, source rights, professional advice, or
user constraints remain unresolved. Mark those items as `needs_review` and keep
the next branch visible.
