# Fallback Mode Example

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

Demonstrates degraded-input handling across phases.

## Segmentation Fallback: Conflicting Sources

```json
{
  "course_material": "doc-a: retries should stop after 3 attempts...\ndoc-b: retries can continue until queue drains...",
  "course_profile": {
    "audience_level": "intermediate"
  }
}
```

Output includes uncertainty markers and rerun hints:

```json
{
  "structured_segments_json": [
    {
      "segment_id": "S10",
      "segment_type": "concept",
      "core_point": "Retry stop conditions differ across sources.",
      "source_span": {"start": 0, "end": 95},
      "uncertainty": "high"
    }
  ],
  "rerun_hints": [
    "Provide authoritative policy for max retry attempts."
  ]
}
```

## Orchestration Fallback: Incomplete Input

```json
{
  "course_material": "doc-1: classify by latency tiers\n\ndoc-2: classify by resource contention\n\ndoc-3: missing section ordering",
  "generation_constraints": {
    "lesson_granularity": "medium"
  }
}
```

Pipeline produces partial but runnable output:

```json
{
  "course_index": [
    {
      "lesson_id": "L03",
      "lesson_title": "Choose a Classification Axis",
      "core_question": "When should you prefer latency tiers over contention classes?",
      "uncertainty": "medium"
    }
  ],
  "rerun_plan": {
    "lessons_to_rerun": ["L03"],
    "reason": "conflicting taxonomy across doc-1 and doc-2"
  }
}
```

```md
## L03 Objective
Select a first-pass classification rule.
---
?[latency first | contention first]
---
Current evidence is partial; confirm one canonical taxonomy before final pass.
```

## Generation Fallback: Minimal Segments

```json
{
  "course_material": "structured_lesson_segments",
  "teaching_constraints": {
    "max_interactions": 2,
    "allow_cross_lesson_dependency": false
  }
}
```

```json
{
  "lesson_id": "L07",
  "fallback_mode": true,
  "assumptions": [
    "No cross-lesson variable carryover is used."
  ],
  "upgrade_notes": [
    "Add richer evidence chain after full source context is available."
  ]
}
```

## Optimization Fallback: No Source Material

```json
{
  "existing_teaching_prompt": "## Goal\nPick a fix.\n---\n?[%{{fix_choice}} option A | option B]\n---\nUse {{fix_context}} now.",
  "course_material": "",
  "optimization_constraints": {
    "fallback_mode": true,
    "minimize_scope": true
  }
}
```

```json
{
  "risk_and_issue_report": {
    "overall_risk": "high",
    "blocking_issues": ["variable_or_syntax_risk"],
    "coverage_status": "unknown_without_source"
  },
  "follow_up": [
    "Provide source material for full coverage audit."
  ]
}
```

## Acceptance Notes

- Each phase degrades gracefully instead of failing hard.
- Uncertainty is marked explicitly, never silently merged.
- Rerun hints guide the user toward resolution.
- Output schemas remain compatible across standard and fallback modes.
