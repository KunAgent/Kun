## ADDED Requirements

### Requirement: Pending input remains visible and actionable
When a user submits input while a turn is running, the renderer SHALL present each pending message as a compact row above the composer with its text, a remove action, and a Guide action when guidance is supported.

#### Scenario: Message is queued during a running turn
- **WHEN** the user submits non-empty input while the active thread has a running turn
- **THEN** the message appears in a pending row and remains scheduled for ordinary next-turn delivery

#### Scenario: User removes pending input
- **WHEN** the user activates Remove on a pending row
- **THEN** the renderer removes that message without steering or sending it

#### Scenario: Structured input is not eligible for text guidance
- **WHEN** a queued message contains attachments, file references, extension context, write context, plan context, or structured design context
- **THEN** Guide is disabled with an accessible explanation and ordinary queued delivery remains available

### Requirement: Guide injects input at the next model boundary
For an eligible pending text message, the renderer SHALL let the user explicitly guide the active native Kun turn, and Kun MUST persist that text as a user message before the next model request.

#### Scenario: Guidance is accepted during model streaming
- **WHEN** the user activates Guide while a native Kun model response is in progress and the steer request is accepted
- **THEN** the renderer removes the message from its pending queue and Kun includes the persisted user message in the next LLM interaction of the same turn

#### Scenario: Final model response receives guidance
- **WHEN** guidance is accepted while a model response would otherwise finish the turn
- **THEN** Kun continues the same turn with another model request that includes the guidance

#### Scenario: Duplicate Guide activation is prevented
- **WHEN** a Guide request for a pending row is in flight
- **THEN** that row's Guide and Remove actions are disabled until the request settles

### Requirement: Guidance handoff never loses input
The system MUST remove a renderer-owned pending message only after Kun accepts ownership, and Kun MUST NOT accept guidance after the native turn has sealed its terminal boundary.

#### Scenario: Turn completion wins the race
- **WHEN** the native turn seals completion before a steer request is admitted
- **THEN** Kun rejects the steer request and the renderer keeps the message queued for ordinary next-turn delivery

#### Scenario: Guidance request fails
- **WHEN** the provider does not support steering or Kun rejects the request because the turn is inactive or the steering buffer is full
- **THEN** the renderer keeps the message queued and surfaces a localized error

#### Scenario: Accepted guidance wins the race
- **WHEN** Kun admits guidance before terminal sealing
- **THEN** the native loop does not complete until it has persisted the guidance and performed the next permitted model interaction
