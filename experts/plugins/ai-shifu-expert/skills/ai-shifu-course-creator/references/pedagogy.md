# Pedagogy

Authoritative source for **Teaching Prompt** design constraints — patterns, cognitive techniques, segmentation methodology, optimization methodology, and the teaching-side rules around variables, interactions, and visual-text coordination. Violating anything here generally produces a Teaching Prompt that *runs* but teaches poorly.

For format syntax / runtime constraints (which make any prompt fail to parse), see [markdownflow.md](markdownflow.md). For Course Prompt design (the course-level AI persona / style document), see [course-prompt.md](course-prompt.md).

## Script Style

A Teaching Prompt is the per-lesson MarkdownFlow document the AI engine reads at runtime — it is a *script that guides teaching*, not a polished learner-facing lecture. Write in imperative, model-guiding language.

Preferred patterns:
- "Explain to the learner …"
- "Ask the learner to …"
- "Have the learner choose …"
- "After collecting {{var}}, carry the learner's answer into the later lesson or Course Prompt that needs it …"

Disallowed patterns:
- Long, polished prose written as if it is the final learner-facing lecture.
- Author/lesson-plan meta narration (e.g., "Knowledge Block …", "In this lesson you will …", "Deliverable: …").
- Author-side meta labels such as "Knowledge Block 1/2/3", "Lesson Objective", or "Deliverable" — keep those as implicit structure, not visible narration.
- Exposing internal authoring terms in learner-facing text.

## Teaching Patterns

### Pattern A: Evidence Chain

1. Observable phenomenon
2. Mechanism explanation
3. Practical implication
4. Learner interaction
5. Summary and action

### Pattern B: Misconception Repair

1. Surface common misconception
2. Explain why it sounds plausible
3. Correct with mechanism and boundary
4. Run interaction check
5. Apply corrected model to a real case

### Pattern C: Comparison-Driven Learning

1. Baseline response capture
2. Alternate scenario or constraint
3. Side-by-side interpretation
4. Updated decision path

## Cognitive Techniques

Increase learner understanding through targeted cognitive moves rather than information dumping. Each lesson should include at least one of these as a deepening interaction.

1. **Calibration prompt** — Ask learners to make a concrete judgment before explanation.
2. **Boundary framing** — Clarify where the concept works and where it breaks.
3. **Counterintuitive contrast** — Introduce a surprising but valid case to deepen mental models.
4. **Action translation** — Turn conceptual understanding into an immediately executable step.
5. **Reflection loop** — Ask learners to compare current understanding with prior assumptions.

## Lesson Loop

Every lesson must satisfy a minimum teaching loop and a few cross-cutting constraints:

- **Minimum teaching loop**: setup → explanation → interaction → close. A lesson missing any of these four phases is incomplete.
- **One core question per lesson**: each lesson resolves exactly one teachable question.
- **Action tasks** must be either immediately executable by the learner or explicitly linked to a downstream lesson — no orphan actions.
- **Variable naming** must be consistent and traceable across lessons (use the same name for the same concept; cross-check with [data-contracts.md#variable-table](data-contracts.md#variable-table)).
- **Source information density** must be preserved through optimization — do not trade substance for fluency.
- **Carryover statements** are allowed only when cross-lesson dependency is explicitly permitted; otherwise remove them along with any unbound carryover variables.

## Segmentation Methodology

### Objective

Produce stable lesson-oriented semantic segments from noisy source material while preserving immutable artifacts.

### Core Rules

1. Preserve source order unless explicit ordering hints are provided.
2. Keep code/image/table blocks immutable.
3. Segment by semantic shift, not heading depth alone.
4. Keep each lesson candidate centered on one teachable question.
5. Attach source spans to every segment.

### Segment Types

- `concept`: explanatory statements and definitions.
- `example`: concrete demonstrations and walkthroughs.
- `code`: executable or pseudo-code blocks.
- `image`: visual references and diagrams.
- `exercise`: learner action prompts.
- `transition`: bridge text that links ideas.

### Transfer Signals

Every segment should include transferable signals for downstream script quality:
- learner hook
- evidence type
- visual cue
- concept conflict
- boundary cue
- action cue
- density cue
- quote cue
- visual-text-pair cue
- interaction-intent cue
- compare cue

### Failure Handling

If structure is weak, output a fallback segmentation and mark uncertain spans for focused reruns.

## Optimization Methodology

### Principles

1. Correctness before style.
2. Minimal safe edits before broad rewrites.
3. Learner impact before formatting polish.
4. Traceable changes with explicit rationale.

### Issue Taxonomy

- Coverage gap
- Meaning shift
- Explanation clarity
- Interaction no-branching
- Visual requirement missing
- Variable or syntax risk

### Execution Sequence

1. Build source-to-script coverage matrix.
2. Rank issues by learner risk and runtime risk.
3. Fix blockers first.
4. Revalidate variable lifecycle and interaction effects.
5. Run final syntax and density checks.

## Variable Strategy

These are the *teaching* rules around variables — when to collect, how often, how to ensure they matter. For variable *syntax* see [markdownflow.md#variables](markdownflow.md#variables); for variable *schema* see [data-contracts.md#variable-table](data-contracts.md#variable-table).

- Prefer at most one variable collection per module; distribute, don't front-load.
- Max five interactions per lesson (recommended three to four).
- No more than three consecutive variable collections before learner-visible feedback.
- Reuse global variables when possible; add new named variables only when a learner answer must leave the current lesson.
- Create a variable only when the learner's answer must be used outside the current lesson: referenced by `course-prompt.md`, reused in another lesson, or used for cross-lesson personalization, depth control, examples, summaries, or deliverable variation.
- Use no-variable `?[...]` for lesson-local interactions, including current-lesson branching, examples, feedback, summaries, and free-text inputs.
- Treat every variable reference as a substituted value. If the learner has not set it, the value is `UNKNOWN`; if fallback behavior is needed, describe what to do when the substituted value is `UNKNOWN`.
- For variable-based branches, state the substituted value in a natural sentence before branching. Example: write `The learner level is {{level}}.` and then branch with `If the learner level is UNKNOWN, ...`.
- Every variable must have course-level or cross-lesson utility; do not create throwaway variables for continue buttons, confirmations, or choices used only inside the current lesson.
- Do not recollect the same variable unless explicitly marked as staged comparison.
- Prevent semantic duplicates even when variable names differ.
- Spread global variable collection across lessons.

## Interaction Design

These are the *teaching* rules around interactions. For interaction *syntax* see [markdownflow.md#interactions](markdownflow.md#interactions).

- Each lesson includes at least one deepening interaction (calibration, boundary check, or misconception correction — see [Cognitive Techniques](#cognitive-techniques)).
- Interaction prompts must be concrete and directly answerable.
- Place interactions at decision points, not only at lesson start.
- Choose the interaction type by the nature of the learner decision:
  - Use single-select for mutually exclusive categories, path choices, viewpoint checks, or any interaction where one selected answer should drive a distinct branch.
  - Use multi-select for non-exclusive learner context, goals, interests, modules, blockers, scenarios, experience, or practice needs.
  - When the interaction prompt means "which of these apply?", prefer multi-select unless the source or user explicitly limits the learner to one answer.
  - For multi-select, drive downstream content through combined feedback, prioritization, tailored examples, or coverage of the selected items; do not require an exhaustive branch for every possible option combination.
- Before writing an interaction, decide whether the answer leaves the current lesson. If it will be referenced by the Course Prompt or another lesson, use a named variable. If it is used only in the current lesson, use no-variable `?[...]`, including for free-text input.
- Every instructional interaction must trigger immediate feedback or a visible current-lesson effect. No-variable interactions can still drive current-lesson branching explanation, examples, practice difficulty, feedback, summaries, deliverables, or free-text reflection.
- When a Course Prompt or later lesson can reference a variable before the collecting interaction has been answered, bind the substituted value in the prompt and write the default branch against `UNKNOWN`, not against variable readiness.
- After every variable-backed interaction, use `{{var}}` only for the intended cross-lesson or course-level effect. For no-variable interactions, branch on the learner's current answer in natural language without `{{var}}`.
- `*_viewpoint_check` interactions must branch by option and drive different next steps.
- Use no more than one `viewpoint_check` per lesson unless justified.
- Avoid repetitive interaction semantics across lessons unless comparison intent is explicit.
- For input interactions, the pre-interaction question must be more specific than the short `...` placeholder.

## Visual-Text Coordination

- If a visual is needed, describe it in natural language as a slide or visual page (e.g., "Create a slide that …").
- Pair every visual instruction with a brief explanation of what the visual is meant to convey.
- Do not embed raw SVG/HTML/Mermaid/PlantUML/Graphviz markup inside Teaching Prompts unless the user explicitly asks for that format.
- Default to natural-language slide/diagram placeholders.
- Every core concept needs visual + textual explanation together; the visual carries structural prompting, the text carries the full explanation (assume the learner has not seen the slide).
