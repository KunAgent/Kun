# Verification Gates

## F: First Value

- `first_value_gate`: five outputs must be present: `supplementCard`, `workbuddyCapabilityMap`, `humanAiTaskTable`, `pilotPacket`, `singleNextStepCta`.
- `context_gate`: the response must lock at least `userIndustry`, `userRole`, and `userGoal` before choosing one workflow gap.
- `single_gap_gate`: only one primary workflow gap is allowed to advance into the pilot packet.
- `highest_value_gap_evidence_gate`: when claiming the highest-value gap, the winner must keep at least one evidence row or be explicitly labeled as `highestValueGapIsHypothesis`.
- `scenario_micro_slice_gate`: before the five-part bundle is finalized, the chosen gap must be grounded in one concrete `actor / moment / blockedAction / AIIntervention / humanDecision / observableArtifact` slice.

## N: No-Connector Mainline

- `no_connector_contract_gate`: the package must stay usable without any connector, MCP tool, or service-side runtime.
- `no_connector_rehearsal_gate`: a machine-readable no-connector rehearsal report must pass before upload readiness can claim package usability.
- `host_action_envelope_gate`: `hostActionEnvelope` is metadata or debug only by default and must not be treated as a real tool call.
- `connector_decoupling_gate`: first value, service intent reporting, review readiness, and local-equivalent readiness must not read connector state, tool visibility, or MCP status.

## C: Continuation

- `continued_use_gate`: the CTA must push the user toward a 3-day pilot packet or project action packet instead of stopping at a static result card.
- `same_binding_gate`: `continued_use_completed` remains the first valid unlock threshold whenever service-side evidence is discussed.
- `lebao_boundary_gate`: `lebao` stays behind `continued_use_completed` and is never treated as payment closure.
- `service_intent_bridge_gate`: `service_intent_report` must remain a distinct bridge layer between host-local first value and real service consume.

## O: Connector-Decoupled Package Surface

- `connector_surface_absent_gate`: the package must not ship `.mcp.json`, `mcpServers`, or equivalent bundled connector declarations.
- `connector_prompt_suppression_gate`: no package metadata may be capable of triggering a host-side connector-connect prompt on expert entry.
- `no_bash_fallback_gate`: service-side observation experiments must not degrade into Bash, shell, or manual HTTP substitution.
- `service_closure_gate`: any future service-side closure evidence must stay outside the user-facing package baseline and must never be promoted from package metadata alone.

## E: Evidence Status Lines

- `localEquivalent`: local `my-experts` installation and visibility.
- `officialEntry`: official expert-center or marketplace listing.
- `naturalSameBinding`: natural same-binding service evidence, kept separate from both package proof and local-equivalent proof.
- `service_observability_gate`: current-window receipts must keep `requestSource`, `hostPatchVersion`, `versionKey`, same-binding progress, and missing forward fields visible.
