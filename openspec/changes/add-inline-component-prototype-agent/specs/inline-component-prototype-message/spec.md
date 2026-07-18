## ADDED Requirements

### Requirement: Render component prototypes inside the conversation
The renderer SHALL display valid `design_component` artifact metadata as an interactive card in the current conversation timeline instead of opening a separate canvas or window.

#### Scenario: Preparing or running artifact
- **WHEN** a preparing or running component artifact update arrives through the normal tool-result event path
- **THEN** the timeline shows an inline loading prototype card at that tool's conversation position

#### Scenario: Completed artifact
- **WHEN** a completed component artifact is replayed live or from persisted thread history
- **THEN** the timeline shows the same inline interactive component card at that conversation position

#### Scenario: Failed artifact
- **WHEN** a failed component artifact is replayed
- **THEN** the timeline shows a bounded inline failure state and does not mount its HTML preview

### Requirement: Preserve producer identity and historical compatibility
The renderer SHALL distinguish directly published prototypes from delegated prototypes while preserving compatibility with historical component-designer metadata that predates the producer field.

#### Scenario: Direct prototype label
- **WHEN** artifact metadata contains `producer: main-agent`
- **THEN** the card identifies Kun as the producer and does not label the artifact as child-agent output

#### Scenario: Delegated prototype label
- **WHEN** artifact metadata contains `producer: component-designer`
- **THEN** the card identifies the design child agent as the producer

#### Scenario: Historical delegated payload
- **WHEN** artifact metadata has the `component-designer` profile but no producer field
- **THEN** the renderer normalizes its producer to `component-designer` and renders the artifact normally

### Requirement: Isolate and operate inline prototypes safely
The renderer MUST authorize only workspace-contained prototype paths and mount each accepted artifact through the existing hardened HTML preview host with an isolated partition.

#### Scenario: Unsafe path metadata
- **WHEN** artifact metadata points outside `.kun-design/component-prototypes/` or contains traversal segments
- **THEN** the renderer rejects the prototype metadata and does not create a preview webview

#### Scenario: User operates a valid card
- **WHEN** the user views a valid prototype card
- **THEN** they can switch desktop and mobile widths, refresh the preview, inspect or copy its code, and prefill the current composer to iterate on or adopt the interaction
