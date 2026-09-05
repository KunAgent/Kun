## ADDED Requirements

### Requirement: QueueDock uses reference disclosure behavior
Kun SHALL render pending composer messages in a QueueDock attached to the composer: zero messages render no dock, one message renders its row directly, and two or more messages render a collapsed total-count header that expands the complete FIFO list in place.

#### Scenario: One queued message
- **WHEN** exactly one pending, paused, or failed queued message is visible
- **THEN** its complete row is shown directly without a count header or Portal

#### Scenario: Multiple queued messages
- **WHEN** two or more queued messages are visible and no queue interaction is active
- **THEN** the dock initially shows only the total count and expands or collapses all rows from the header button

#### Scenario: Interaction keeps rows visible
- **WHEN** a restore-to-composer edit or a queue mutation is active and the queue contains multiple messages
- **THEN** the list remains expanded and the collapse header is disabled until the interaction settles

#### Scenario: Queue resets disclosure
- **WHEN** the visible queue becomes empty and later receives multiple messages
- **THEN** the new queue starts collapsed again

### Requirement: Editing restores the message to the composer
Kun SHALL return eligible queued messages to the composer for editing instead of editing them in place; the restored payload SHALL preserve its frozen routing/model settings, and image attachments SHALL be restored to the composer attachments.

#### Scenario: Restore plain text or image
- **WHEN** the user edits an eligible pending text or image row
- **THEN** the message is removed from the queue by stable id, its text is placed in the composer input, image attachments are restored, and the composer input is focused for further editing

#### Scenario: Restore preserves submission settings
- **WHEN** a restored message carried frozen mode/model/reasoning/permission settings
- **THEN** the composer replays those settings so a resend reproduces the original turn instead of adopting current composer state

#### Scenario: Invalid restore
- **WHEN** the row is no longer pending, or the payload contains structured content or document attachments that cannot be faithfully rebuilt
- **THEN** the edit action is unavailable and the original queued record remains unchanged

### Requirement: Queue actions are lossless and serialized
Kun SHALL expose Edit, Remove, and current-turn Guide in reference order for ordinary pending rows, and SHALL keep paused or failed rows visible with Remove plus Retry only when replay is safe.

#### Scenario: Guide in flight
- **WHEN** one queued row is being guided or retried
- **THEN** duplicate and competing queue mutations are disabled until the request settles

#### Scenario: Guide fails
- **WHEN** current-turn guidance or retry is rejected
- **THEN** the row remains queued and the existing localized error path reports the failure

#### Scenario: Failed delivery remains actionable
- **WHEN** a queued submission reaches the failed state
- **THEN** the QueueDock keeps it visible with failure status and Remove, and enables Retry when the active turn is idle and the row is not tied to a settled provisional admission waiter

#### Scenario: Delivery owns the row
- **WHEN** a row transitions to starting or in-flight delivery
- **THEN** the QueueDock stops rendering it so the admitted user item is not duplicated

### Requirement: QueueDock matches reference geometry and accessibility
Kun SHALL use the frozen Harness QueueDock dimensions and interaction semantics while mapping colors to Kun semantic theme tokens.

#### Scenario: Desktop geometry
- **WHEN** the QueueDock is rendered above the main composer
- **THEN** headers and rows are 36px, actions are 28px, action gaps are 10px, top corners are 12px, the bottom is square and attached to the composer, and the list scrolls internally above 180px

#### Scenario: Narrow composer
- **WHEN** the composer is narrow
- **THEN** the dock remains within composer side insets, preview text ellipsizes, actions remain reachable, and no fixed queue Portal overflows the viewport

#### Scenario: Keyboard and screen reader
- **WHEN** a user navigates the QueueDock without a pointer
- **THEN** the disclosure exposes `aria-controls` and `aria-expanded`, every action has an accessible name and disabled explanation, and the restored composer input receives focus

#### Scenario: Theme behavior
- **WHEN** light, dark, custom-theme, or reduced-motion preferences are active
- **THEN** the dock uses semantic surfaces/borders/text, preserves readable state contrast, and does not require motion to communicate queue state

### Requirement: Expanded queues can be reordered
Kun SHALL let users reorder two or more visible queued rows inside an expanded QueueDock, and SHALL persist the resulting order as the FIFO order used for later delivery.

#### Scenario: Drag before or after a row
- **WHEN** the user drags one queued row over the upper or lower half of another visible row and drops it
- **THEN** a visible insertion indicator identifies the before/after target and the store persists the source row at that position by stable queue id

#### Scenario: Keyboard reorder
- **WHEN** a focused drag handle receives ArrowUp or ArrowDown and a visible neighbor exists
- **THEN** the row moves one position before or after that neighbor and focus remains on its stable handle

#### Scenario: Ordering is unavailable
- **WHEN** the queue is collapsed, contains one visible row, is being restored, or has a pending mutation
- **THEN** drag handles are hidden or disabled and no reorder operation is emitted

#### Scenario: Queue changes during drag
- **WHEN** the dragged row or target is retired by live queue state before drop
- **THEN** transient drag state clears and no unrelated row is reordered

### Requirement: Existing queue delivery contract remains compatible
The QueueDock SHALL reuse Kun's current renderer queue, persistence, FIFO drain, and mid-turn guidance contracts without changing runtime or disk schemas.

#### Scenario: Existing persisted queue
- **WHEN** a thread restores pending, paused, failed, starting, or in-flight queued records created before this UI change
- **THEN** the renderer safely projects each state using the new visibility rules without rewriting stored records

#### Scenario: Ordinary busy-turn send
- **WHEN** the user submits a new message during a running turn and does not activate Guide
- **THEN** it remains queued for ordinary next-turn FIFO delivery exactly as before
