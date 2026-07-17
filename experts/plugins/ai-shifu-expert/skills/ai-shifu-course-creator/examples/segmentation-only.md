# Segmentation Only Example

> Note: Outputs in this example are illustrated in English for clarity. Actual output language follows `references/data-contracts.md#language-resolution` (e.g., Chinese invocation → Chinese output).

## Minimal Input

```json
{
  "course_material": "Today we explain retry strategy... um... first rule is idempotency.\n```python\nretry(order_id)\n```\nThen we map transient vs permanent failure...",
  "chapter_hint": {
    "target_lessons": 2,
    "granularity": "medium"
  },
  "course_profile": {
    "audience_level": "beginner",
    "lesson_duration_minutes": 12,
    "assessment_mode": "project"
  },
  "delivery_constraints": {
    "interaction_density": "medium",
    "must_cover_topics": ["idempotency", "failure taxonomy"]
  },
  "target_language": "en-US"
}
```

## Output Snapshot

```json
{
  "structured_segments_json": [
    {
      "segment_id": "S01",
      "segment_type": "concept",
      "core_point": "Idempotency is the precondition for safe retries.",
      "preserve_block": false,
      "source_span": {"start": 0, "end": 118}
    },
    {
      "segment_id": "S02",
      "segment_type": "code",
      "core_point": "Retry call example",
      "preserve_block": true,
      "source_span": {"start": 119, "end": 156}
    }
  ],
  "preserve_block_index": [
    {"block_id": "B01", "type": "code", "segment_id": "S02"}
  ],
  "lesson_cut_candidates": [
    {
      "lesson_id": "L01",
      "segment_ids": ["S01", "S02"],
      "core_question": "Why is idempotency required before retry logic?"
    }
  ]
}
```

## Edge Case: Conflicting Sources

```json
{
  "course_material": "doc-a: retries should stop after 3 attempts...\ndoc-b: retries can continue until queue drains...\ndoc-c: [image:failure-matrix.png]",
  "course_profile": {
    "audience_level": "intermediate",
    "lesson_duration_minutes": 15
  },
  "delivery_constraints": {
    "must_cover_topics": ["stop condition design"],
    "non_negotiable_fragments": ["[image:failure-matrix.png]"]
  }
}
```

```json
{
  "structured_segments_json": [
    {
      "segment_id": "S10",
      "segment_type": "concept",
      "core_point": "Retry stop conditions differ across sources.",
      "source_span": {"start": 0, "end": 95},
      "uncertainty": "high"
    },
    {
      "segment_id": "S11",
      "segment_type": "image",
      "core_point": "Failure matrix image preserved",
      "preserve_block": true,
      "source_span": {"start": 96, "end": 132}
    }
  ],
  "rerun_hints": [
    "Provide authoritative policy for max retry attempts.",
    "Confirm whether queue-drain mode is allowed in this course."
  ]
}
```

## Acceptance Notes

- Meaning is preserved while filler phrases are removed.
- Code block text and fence language stay unchanged.
- Conflicts are surfaced as uncertainty, not silently merged.
- Output schema remains compatible for downstream phases.
