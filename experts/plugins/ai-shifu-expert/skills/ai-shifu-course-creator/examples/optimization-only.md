# Optimization Only Example

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

## Minimal Input

```json
{
  "existing_teaching_prompt": "## Objective\nUnderstand retry policy.\n---\n?[%{{answer}} yes | no]\n---\nGreat job.",
  "course_material": "Learner must differentiate transient vs permanent failure and choose a matching retry stop rule.",
  "optimization_constraints": {
    "max_interactions": 4,
    "require_branching_feedback": true
  },
  "course_profile": {
    "audience_level": "beginner"
  }
}
```

## Output Snapshot

```json
{
  "risk_and_issue_report": {
    "overall_risk": "medium",
    "blocking_issues": ["interaction_no_branching"],
    "suggestions": ["add explicit stop-condition task"]
  },
  "change_list": [
    {
      "issue_class": "interaction_no_branching",
      "change": "remove the throwaway variable, branch feedback by learner option, and add next-step action"
    }
  ],
  "course_prompt": "# Role\nYou are a coach helping beginners reason about retry policy.\n\n# Task\nDifferentiate transient vs permanent failure and select a retry stop rule.\n\n# Teaching Techniques\nViewpoint branching on failure type; bounded retries with backoff for transient.\n\n# Writing Style\nDirective, action-oriented.\n\n# Format\nMarkdownFlow; `?[]` interactions on standalone lines.\n\n# Slides\nCreate failure-taxonomy slides in natural language."
}
```

```md
## Objective
Differentiate transient and permanent failures before choosing retry policy.
---
?[transient failure | permanent failure]
---
If the learner chooses transient failure, apply bounded retries with backoff.
If the learner chooses permanent failure, stop retries and open a corrective task.
```

## Edge Case: Missing Source Material

```json
{
  "existing_teaching_prompt": "## Goal\nPick a fix.\n---\n?[%{{fix_choice}} option A | option B]\n---\n?[%{{choose_fix}} option A | option B]\n---\nUse {{fix_context}} now.",
  "course_material": "",
  "optimization_constraints": {
    "fallback_mode": true,
    "minimize_scope": true
  },
  "delivery_constraints": {
    "platform_limits": ["markdown_only"]
  }
}
```

```json
{
  "risk_and_issue_report": {
    "overall_risk": "high",
    "blocking_issues": [
      "variable_or_syntax_risk",
      "semantic_duplicate_interactions"
    ],
    "coverage_status": "unknown_without_source"
  },
  "change_list": [
    {
      "issue_class": "variable_or_syntax_risk",
      "change": "remove the learner-answer reference with no collection contract and keep one canonical no-variable interaction"
    }
  ],
  "follow_up": [
    "Provide source material for full coverage and meaning audit."
  ]
}
```

```md
## Goal
Pick one safe first fix.
---
?[option A | option B]
---
After the learner answers, apply one verification step before rollout.
```

## Acceptance Notes

- Syntax stays runnable after edits.
- Coverage and meaning are closer to source material.
- Runtime safety fixes are applied first.
- Missing-source uncertainty is explicit in the report; `course_prompt` artifact is omitted when `course_material` is empty (per SKILL.md `## Optimization` → Validation).
- Edits stay minimal and avoid broad rewrites.
