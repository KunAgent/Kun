# Runtime Boundary Summary

This package should stay useful across three runtime layers:

1. `self-contained package layer`
   The package itself contains the expert identity, absorbed writing
   references, and no-connector first-value behavior.
2. `host orchestration layer`
   The host may provide project-template context, local-equivalent installation,
   or frontstage entry behavior, but the package must still produce first value
   without assuming any connector or MCP tool.
3. `external observation layer`
   Host or service traces can help diagnose distribution behavior, but this
   layer is never the same thing as package capability.
4. `service orchestration layer`
   Internal service fields, benefit-state records, and same-binding closure
   contracts may be used for debugging and post-listing attribution, but they
   must not replace the offline first-value writing path.

Do not confuse these layers:

- A good package is not the same as service closure.
- A local frontstage binding is not the same as official distribution proof.
- A host or service trace is not the same as the package compatibility baseline.
- User language has priority over host language defaults. The overseas host defaults to English only when user language is ambiguous; a Chinese prompt on WorkBuddyAI should remain Simplified Chinese.
- `hostActionEnvelope` and `serviceCoordinationHints` are allowed package
  interfaces; they are not proof that service tools actually ran. They should
  normally travel through host metadata, rehearsal reports, or explicit debug
  output, not through ordinary user-facing manuscript prose.
- User-visible manuscript output must not leak tool names, routing fields,
  action envelopes, service metadata, workspace memory instructions, or
  implementation notes unless the user explicitly asks for debug metadata.
- WorkBuddyAI must use its own `.workbuddy-ai` namespace for host memory or
  runtime state. A hidden reminder that points a WorkBuddyAI project at
  `.workbuddy` is a host namespace bug, not a package writing requirement.
- Host version evidence must name its evidence layer. WorkBuddy local 5.1.3,
  service matrix 5.1.2 preset evidence, historical WorkBuddy 5.1.1 rows, and
  WorkBuddyAI 5.1.0 cannot be collapsed into one current runtime claim.
- `fbss_bookwriter_start`, `skill_whoami`, `fbs_scene_pack_query`, and
  `skill_consume` are observation surfaces. Missing them must not block first
  value, but available results should be preserved for debugging.
- Network enhancement is an evidence-upgrade layer, not a first-value
  prerequisite. When research is needed, keep the manuscript result separate
  from the verification to-do list and name whether the current claim state is
  offline, research-assisted, or externally blocked.
- `claim`, `entitlement`, `benefitState`, and `lebao` signals are not payment
  closure; same-binding continued use remains the minimum service-side boundary.
