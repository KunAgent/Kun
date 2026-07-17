# Generation Only Example

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

## Minimal Input

```json
{
  "course_material": "structured_lesson_segments",
  "teaching_constraints": {
    "max_interactions": 4,
    "require_visual_text_pair": true
  },
  "course_profile": {
    "audience_level": "beginner",
    "lesson_duration_minutes": 10
  },
  "delivery_constraints": {
    "interaction_density": "medium"
  }
}
```

Structured segments provided:

```json
[
  {
    "lesson_id": "L02",
    "core_question": "How do you verify that a fix removed the bottleneck?",
    "segment_ids": ["S21", "S22"]
  }
]
```

## Output Snapshot

```json
{
  "lesson_id": "L02",
  "lesson_title": "Verify the Fix",
  "teaching_prompt": "## Objective\nChoose the fastest signal that proves the fix works.\n---\n?[p95 latency trend | error-rate slope | lock-wait drop]\n---\nAfter the learner answers, use the selected signal as the first verification checkpoint.",
  "used_variables": [],
  "depends_on_lessons": ["L01"]
}
```

Rendered `teaching_prompt` value:

```md
## Objective
Choose the fastest signal that proves the fix works.
---
?[p95 latency trend | error-rate slope | lock-wait drop]
---
After the learner answers, use the selected signal as the first verification checkpoint.
```

## Edge Case: Fallback with Minimal Context

```json
{
  "course_material": "structured_lesson_segments",
  "teaching_constraints": {
    "max_interactions": 2,
    "must_use_viewpoint_check": true,
    "allow_cross_lesson_dependency": false
  },
  "delivery_constraints": {
    "platform_limits": ["markdown_only"]
  }
}
```

```json
{
  "lesson_id": "L07",
  "lesson_title": "Pick a Rollback Trigger",
  "teaching_prompt": "## Objective\nPick a rollback trigger that minimizes blast radius.\n---\n?[latency spike threshold | error budget burn threshold]\n---\nAfter the learner answers, define one immediate rollback condition and one follow-up diagnostic for the selected trigger.",
  "used_variables": [],
  "depends_on_lessons": [],
  "fallback_mode": true,
  "assumptions": [
    "No cross-lesson variable carryover is used.",
    "One viewpoint check is enough for this pass."
  ],
  "upgrade_notes": [
    "Add richer evidence chain after full source context is available."
  ]
}
```

Rendered `teaching_prompt` value:

```md
## Objective
Pick a rollback trigger that minimizes blast radius.
---
?[latency spike threshold | error budget burn threshold]
---
After the learner answers, define one immediate rollback condition and one follow-up diagnostic for the selected trigger.
```

## Acceptance Notes

- At least one interaction drives current-lesson text changes.
- Core idea includes visual-plus-text explanation in final script.
- Script remains valid in fallback mode.
- Interaction count stays within declared limits.
