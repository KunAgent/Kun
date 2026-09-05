## ADDED Requirements

### Requirement: Model request failures preserve their source
Kun SHALL persist whether a failed model request received a provider response, was sent without receiving a response, or failed before sending.

#### Scenario: Provider returned an error
- **WHEN** a model provider returns an HTTP or streamed error response
- **THEN** the durable error records `provider_responded` with the safe provider/model identity, original redacted message, and available HTTP status, provider code, category, and retry timing

#### Scenario: Provider did not respond
- **WHEN** a model request is attempted but fails at the network or transport layer without a provider response
- **THEN** the durable error records `sent_no_response` and does not claim that the provider returned the failure

#### Scenario: Request failed before sending
- **WHEN** provider resolution, credential access, or local request preparation fails before a provider request is dispatched
- **THEN** the durable error records `not_sent` and identifies the requested provider and model when known

### Requirement: Provider response data survives conversation recovery
Kun SHALL preserve model-request failure provenance through live delivery, Error Item persistence, terminal settlement, snapshots, and event replay.

#### Scenario: Reload a failed conversation
- **WHEN** a user reloads a conversation containing a provider-returned error
- **THEN** the restored error retains the same source, provider/model identity, original redacted message, status, and provider code shown during the live turn

#### Scenario: Receive duplicate terminal diagnostics
- **WHEN** an immediate model Error Event and the corresponding terminal failure are both projected
- **THEN** the conversation contains one enriched error card rather than duplicate cards

### Requirement: Agent timelines visibly identify provider responses
Every Agent conversation timeline SHALL render a provider-returned error with a prominent localized source label, a friendly summary, and the redacted provider message visible without expanding technical details.

#### Scenario: Render provider overload
- **WHEN** an Agent turn fails with provider code `server_is_overloaded`
- **THEN** the error card visibly states that the provider returned the error, shows provider/model identity and the provider message, and displays available status and code metadata

#### Scenario: Render transport failure
- **WHEN** an Agent turn has `sent_no_response`
- **THEN** the card states that no provider response was received and does not display the provider-returned label

#### Scenario: Render local preflight failure
- **WHEN** an Agent turn has `not_sent`
- **THEN** the card states that the model request was not sent, displays the local cause, and does not display the provider-returned label

#### Scenario: Render legacy failure
- **WHEN** a historical runtime error has no model-request failure provenance
- **THEN** the existing generic runtime-error presentation remains available

### Requirement: Provider errors remain safe and accessible
The provider error presentation SHALL redact sensitive values, avoid exposing headers or full provider URLs, support keyboard and screen-reader access, and remain usable across supported themes, locales, and narrow layouts.

#### Scenario: Provider message contains a secret-like value
- **WHEN** a provider error message or technical detail contains a recognized credential pattern
- **THEN** the conversation displays a redacted value and never exposes the original secret

#### Scenario: Inspect technical details
- **WHEN** the user expands the technical details control
- **THEN** the control is keyboard accessible and reveals only safe structured failure metadata
