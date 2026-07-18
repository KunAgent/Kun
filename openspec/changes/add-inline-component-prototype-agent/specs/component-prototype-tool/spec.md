## ADDED Requirements

### Requirement: Publish a component prototype without mandatory delegation
Kun SHALL expose a main-agent `design_component` tool that can validate, harden, persist, and return one standalone interactive component HTML artifact without starting a child agent.

#### Scenario: Main agent supplies complete HTML
- **WHEN** the tool receives complete standalone HTML that satisfies the component artifact contract
- **THEN** it persists the artifact under `.kun-design/component-prototypes/`, returns completed metadata with `producer: main-agent`, and does not create a child run

#### Scenario: Subagents are disabled
- **WHEN** subagents are disabled or unavailable and the main agent supplies valid complete HTML
- **THEN** the tool remains advertised and publishes the component prototype successfully

### Requirement: Optionally delegate component generation
Kun SHALL allow `design_component` to invoke the built-in `component-designer` profile when the caller supplies a design request instead of complete HTML.

#### Scenario: Request-only generation succeeds
- **WHEN** the tool receives a design request, the delegation runtime is enabled, and the component designer creates a valid artifact
- **THEN** the tool returns completed metadata with `producer: component-designer`, the profile and child identifiers, and the hardened artifact path

#### Scenario: Request-only generation is unavailable
- **WHEN** the tool receives a design request without HTML while the delegation runtime is disabled
- **THEN** the tool returns a replayable failed artifact result that explains complete HTML can be supplied directly

#### Scenario: HTML and request are both supplied
- **WHEN** the tool receives both complete HTML and a design request
- **THEN** it uses the direct HTML publication path and does not start a child run

### Requirement: Enforce a bounded offline artifact contract
Kun MUST reject component prototype content that is incomplete, page-embedded, remotely dependent, network-capable, storage-dependent, outside the reserved workspace path, or larger than the configured artifact limit.

#### Scenario: Valid artifact is hardened
- **WHEN** supplied or generated HTML contains one component marker root and no forbidden behavior
- **THEN** Kun replaces any supplied Content Security Policy with its offline policy and returns byte-size and content-hash metadata

#### Scenario: Invalid artifact fails closed
- **WHEN** supplied or generated HTML violates the artifact contract
- **THEN** Kun does not surface it as an interactive preview and returns a structured failed artifact result with an actionable error
