# Creative Library Verification Gates

## CL: Creative Library

- `creative_schema_gate`: every JSONL row must include the schema-required fields.
- `creative_context_gate`: every JSONL row must include `persona_anchor`, `timing_pattern`, `format_strategy`, and `evolution_evidence_note`.
- `creative_tag_gate`: `offline` / `online` / `stakeholder` must all be covered.
- `creative_count_gate`: the seed library must contain at least 20 cards.
- `next_step_gate`: each card must contain exactly one `unique_next_step`.
- `boundary_gate`: each card must state a human approval boundary for external commitment or activation.
- `evidence_bind_gate`: each card must include at least one source evidence row.
- `evolution_layer_gate`: cards using capability claims must distinguish overview capabilities, changelog-confirmed capabilities, and locally observed combinations.
- `timing_pattern_gate`: cards must state whether they are primarily pre-meeting, in-meeting, post-meeting, or full-cycle.
- `format_strategy_gate`: cards must match output format to reader cognitive load.
- `artifact_load_gate`: cards using preview, HTML, PDF, image, or auto-loaded outputs must declare those outputs explicitly.
- `automation_safe_gate`: cards using automation must declare paused-by-default behavior.

## CE: Creative Enhancement Boundary

- `creative_no_connector_gate`: cards must not make connector or service runtime a prerequisite for first value.
- `creative_optional_remote_gate`: assistant, mini-program, mobile push, bot push, and connector routes must be labeled optional.
- `creative_host_local_gate`: preview, present_files, local files, workspace memory, and render outputs remain `host_local`.
- `creative_single_cta_gate`: enhancement exploration may offer choices, but final card execution still ends with one next step.
- `policy_evidence_gate`: when a card is triggered by latest policy direction, it must map policy text into one concrete workflow gap, bind to `contracts/policy-direction-ledger-202606.json`, include `policyWindow`, `sourceUrl`, `retrievedAt`, `evidenceStrength`, and `clientUseStatus`, and avoid turning policy direction into direct business-closure claims.
- `policy_freshness_gate`: latest-policy cards must pass the ledger freshness window (`primaryTriggerDate=2026-06-18`, `recentPolicyEnd=2026-06-19`, `freshnessDays<=14`) or explicitly show a citation gap instead of claiming current-policy fit.
- `policy_repost_boundary_gate`: `authoritative_repost` rows are allowed for internal mapping only; customer-facing citation requires primary URL review before the row can be treated as directly citable.
