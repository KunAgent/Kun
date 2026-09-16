## Purpose

为窗口式上下文提供本地、按需、有界的历史检索和持久工作笔记，使任务在清理模型上下文后仍能恢复事实与进度，同时保持线程隔离和数据生命周期一致。

## ADDED Requirements

### Requirement: Prior windows are locally retrievable
Enabled sessions SHALL offer paginated window/item listing, item reading, and textual content search over retained conversation history without depending on a remote Codex service.

#### Scenario: Recover an earlier decision
- **WHEN** the model searches for text in an earlier window
- **THEN** results identify the source window and item and allow bounded reading of the original retained text

#### Scenario: History predates feature activation
- **WHEN** a thread enables window mode after prior summary compaction
- **THEN** queries expose available retained history and do not fabricate previously removed records

#### Scenario: Attachment item
- **WHEN** a history read targets an attachment
- **THEN** it returns metadata and an access-controlled reference rather than unbounded inline binary data

### Requirement: Working notes persist across windows
Enabled sessions SHALL offer listing by prefix, reading, searching, appending, and replacing thread-private logical notes. Notes MUST remain separate from automatic long-term memory and MUST NOT be inserted wholesale into the stable system prompt.

#### Scenario: Save and recover progress
- **WHEN** the model writes a progress note, transitions windows, and reads the note
- **THEN** the committed content remains available after both transition and runtime restart

#### Scenario: Conflicting or repeated writes
- **WHEN** replacement uses a stale revision or an append retries the same operation
- **THEN** replacement reports conflict and the repeated append does not duplicate content

### Requirement: Tool access is gated and scoped
The system MUST gate both advertisement and execution on the accepted mode and derive thread/agent identity from trusted execution context.

#### Scenario: Disabled invocation
- **WHEN** a disabled turn attempts to invoke a history, notes, or new_context tool
- **THEN** the runtime rejects it even if a caller knows the tool name

#### Scenario: Cross-thread or filesystem access
- **WHEN** arguments attempt to select another thread or escape a note's logical namespace
- **THEN** access is rejected without reading or modifying the target

#### Scenario: Historical instructions
- **WHEN** retrieved text includes old instructions or tool output
- **THEN** it is presented as historical evidence and cannot expand current permissions

### Requirement: Requests and results are bounded
The system SHALL enforce bounded paging, text writes, query length, total note storage, and response sizes before retaining tool content in model history. Truncated results MUST remain structurally valid and expose continuation metadata where more content exists.

#### Scenario: Excessive arguments
- **WHEN** a caller exceeds 100 items per page, a 1024-character query, or 16 KiB of write text
- **THEN** it receives a bounded validation error without committing oversized note content

#### Scenario: Large read result
- **WHEN** a history or notes result exceeds 16 KiB or the smaller of the configured tool token cap and 4096 tokens
- **THEN** a bounded valid result reports truncation and a continuation position

#### Scenario: Note quota exceeded
- **WHEN** a write exceeds 256 KiB per file, 100 files, or 2 MiB total per thread
- **THEN** it fails without partial mutation or silent eviction

### Requirement: History and notes follow thread lifecycle
The system SHALL preserve data on resume/archive, isolate forks and child agents, and remove feature-owned data when its thread is deleted.

#### Scenario: Fork from a prior point
- **WHEN** a thread is forked at a historical point
- **THEN** the child receives only history, boundaries, and note revisions available at that point and later writes do not affect the parent

#### Scenario: Child agent inherits mode
- **WHEN** an enabled agent creates a child agent
- **THEN** the child uses the enabled strategy with its own history and notes rather than access to the parent's private data

#### Scenario: Disable and resume
- **WHEN** window mode is disabled and the thread is resumed or re-enabled later
- **THEN** persisted history, notes, and boundaries remain readable by the runtime without automatic deletion

#### Scenario: Delete a thread
- **WHEN** the owning thread is deleted
- **THEN** associated window indexes and feature-owned historical and note data are deleted through the existing lifecycle
