## ADDED Requirements

### Requirement: Feedback capture reflects actual injection without changing retrieval

Kun SHALL record retrieval feedback only after an authorized active Memory has survived relevance and prompt budgets and has been assembled into a turn's Memory context. Search, list, diagnostics, ranking candidates that are not selected, and evaluator runs SHALL NOT record production retrieval feedback. Feedback collection and persistence SHALL remain outside the production ranking calculation until a separate decision gate authorizes it.

#### Scenario: Candidate is excluded by the prompt budget

- **WHEN** a relevant Memory is ranked but omitted or truncated away by the final prompt budget
- **THEN** Kun does not record that omitted record as retrieved for the turn

#### Scenario: Memory is included through filesystem fallback

- **WHEN** SQLite is degraded and an authorized relevant Memory is assembled through filesystem fallback
- **THEN** Kun may record the same retrieval feedback shape without changing fallback ordering or eligibility

#### Scenario: Feedback recording is unavailable

- **WHEN** selected Memory context has already been assembled but feedback recording is disabled or fails
- **THEN** selected ids, ranking features, context text, and turn completion remain identical to the no-feedback baseline

#### Scenario: Inspect a retrieval trace before ranking feedback is approved

- **WHEN** diagnostics expose the latest production retrieval
- **THEN** its final score contains only the approved lexical-foundation features and no feedback contribution
