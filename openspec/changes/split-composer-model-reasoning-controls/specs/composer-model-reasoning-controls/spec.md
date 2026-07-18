## ADDED Requirements

### Requirement: Code-only separate composer controls
The Code chat composer SHALL present model selection and reasoning effort as two distinct sibling controls. Other composer surfaces SHALL retain their combined control presentation.

#### Scenario: Code chat composer
- **WHEN** the Workbench route is Code chat
- **THEN** the toolbar shows one control containing only the active model and a separate reasoning control containing the active effort

#### Scenario: Other composer surface
- **WHEN** a Design, Write, SDD, or Connect composer is rendered
- **THEN** it retains the existing combined model-and-reasoning control

#### Scenario: Active turn
- **WHEN** a turn is in progress
- **THEN** both visible controls remain operable and a new selection configures the next submitted turn without changing the request already in flight

### Requirement: Focused model menu
In Code chat, the model control SHALL open a menu dedicated to provider and model selection without embedding reasoning selection.

#### Scenario: Select a configured model
- **WHEN** the user opens the model menu and selects a model from a provider group
- **THEN** the composer updates the provider/model selection and closes the model menu

#### Scenario: Search models
- **WHEN** the user enters a filter in a provider model list
- **THEN** the model menu shows matching configured models while preserving capability badges and switch safeguards

#### Scenario: No configured chat provider
- **WHEN** no configured chat-model provider is available
- **THEN** the model control shows provider setup guidance and keeps the provider settings action reachable

### Requirement: Model-aware rail stops
The Code reasoning control SHALL derive its selectable values from the selected model profile and SHALL never submit an unsupported effort.

#### Scenario: Supported effort mapping
- **WHEN** the reasoning control resolves its supported effort set
- **THEN** it SHALL sort and deduplicate `off`, `low`, `medium`, `high`, `max`, and `auto`, distribute only those values across the rail, and place `auto` at the far-right stop

#### Scenario: Unsupported saved effort
- **WHEN** the current saved effort is absent from the newly selected model's supported efforts
- **THEN** the composer selects that model's declared default effort and notifies the existing reasoning change callback

#### Scenario: Sparse supported efforts
- **WHEN** a model supports only a subset of efforts
- **THEN** click, drag, and keyboard input SHALL select only the evenly distributed supported stops

### Requirement: Minimal discrete energy rail
The Code reasoning popover SHALL represent efforts on a discrete blue-to-magenta energy rail between `更快` and `更智能` endpoints and SHALL snap all interaction to supported presets.

#### Scenario: Minimal visual content
- **WHEN** the reasoning popover is open
- **THEN** it shows the decorative `更快` and `更智能` endpoints, the rail, supported-stop nodes, and thumb, adding the vivid multi-stop fill, animated bubbles, and layered sweep light only in an energized effort; it SHALL not show a title, logo, effort-name labels, an Adaptive button, a visible border, or an anchor notch

#### Scenario: Pointer selection
- **WHEN** the user clicks or drags the reasoning rail
- **THEN** the thumb snaps to the nearest supported effort and updates the trigger label and existing reasoning callback immediately

#### Scenario: Select Adaptive
- **WHEN** the model supports `auto` and the user selects the far-right rail stop
- **THEN** `auto` becomes the active effort and the trigger displays the localized Adaptive value

### Requirement: Accessible reasoning operation
The reasoning control SHALL provide keyboard, focus, and assistive-technology behavior equivalent to pointer operation.

#### Scenario: Keyboard changes effort
- **WHEN** focus is on the reasoning rail and the user presses Left, Right, Home, or End
- **THEN** selection moves among supported efforts only and exposes the localized effort name as the slider value text

#### Scenario: Close with Escape
- **WHEN** the reasoning popover is open and the user presses Escape
- **THEN** the popover closes and focus returns to the reasoning trigger

#### Scenario: Trigger semantics
- **WHEN** assistive technology reads the reasoning trigger
- **THEN** it receives the control name, current effort, disabled state, and expanded state

### Requirement: Motion and theme behavior
The Code reasoning interaction SHALL use Kun-themed feedback without compromising reduced-motion preferences or light/dark readability.

#### Scenario: Change to a deeper effort
- **WHEN** motion is allowed and the user selects a supported deeper effort
- **THEN** the thumb and fill transition to the new stop and a short non-blocking glow confirms the selection

#### Scenario: Rail ambience
- **WHEN** the reasoning popover is open, motion is allowed, and the selected effort is `high`, `max`, or `auto`
- **THEN** the rail's blue-to-magenta colors visibly travel across the entire filled area in a continuous seamless loop while a bounded set of decorative bubbles independently drifts, scales, and changes brightness inside the fill and a soft highlight sweeps across it without affecting layout, input, or accessibility

#### Scenario: Calm lower efforts
- **WHEN** the selected effort is `off`, `low`, or `medium`
- **THEN** the filled rail remains solid blue without gradient travel, sweep light, or decorative bubbles

#### Scenario: Reduced motion
- **WHEN** the operating system requests reduced motion
- **THEN** selection remains fully functional while entry, thumb, glow, gradient-overlay, sweep-light, and bubble motion are removed or made immediate

#### Scenario: Theme variants
- **WHEN** the app switches between light and dark themes
- **THEN** the reasoning trigger, popover, rail, labels, focus indicator, and selected state use theme-aware tokens with readable contrast

### Requirement: Borderless Code toolbar layout
The Code controls SHALL remain understandable without visible trigger frames or overlap with adjacent actions.

#### Scenario: Default composer width
- **WHEN** the Code composer has normal horizontal space
- **THEN** the model trigger shows only its model label and chevron, and the reasoning trigger shows only `推理 · <effort>` and its chevron

#### Scenario: Constrained Code width
- **WHEN** the available Code composer width is constrained
- **THEN** the model label truncates independently while the reasoning label, voice, optimize, send, and stop controls remain unobstructed

### Requirement: Preserve existing runtime semantics
Changing the composer UI SHALL preserve existing session reasoning state and turn request behavior.

#### Scenario: Submit after reasoning change
- **WHEN** the user selects a supported effort and sends the next turn
- **THEN** the existing turn submission path receives that named `reasoningEffort` value without any new runtime or IPC field

#### Scenario: Session state
- **WHEN** the user changes reasoning effort in Code chat
- **THEN** the existing Workbench session state supplies that effort to the next turn without adding persistence or a runtime contract field

#### Scenario: Change settings during an active turn
- **WHEN** the user changes the model or reasoning effort while a turn is in progress
- **THEN** the in-flight turn keeps the model and reasoning values captured at submission and the next submitted turn receives the newly selected values
