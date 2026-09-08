import type { ReactElement, RefObject } from 'react'
import type { ToolBlock } from '../../agent/types'
import type {
  TurnProcessTimelineEntry,
  TurnTimelineEntry
} from './derive-turn-sections'
import { MessageBubble } from './message-timeline-bubbles'
import { WorkMetaRow } from './message-timeline-cards'
import { ProcessSectionRow } from './message-timeline-process'
import { TimelineRuntimeError } from './message-timeline-jump-preview'
import type { OpenChildThreadHandler } from './SubagentCallCard'

export type OrderedTurnTimelineProps = {
  entries: readonly TurnTimelineEntry[]
  isProcessing: boolean
  expanded: boolean
  onToggle: () => void
  durationMs?: number
  reasoningDurationMs?: number
  workspaceRoot: string
  viewportRef: RefObject<HTMLDivElement | null>
  allowThreadActions: boolean
  allowRecoveryContinue: boolean
  onContinueInterrupted: () => void
  onOpenChildThread?: OpenChildThreadHandler
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
  forkAction?: { blockId: string; busy: boolean; onFork: () => void }
  rollbackAction?: { blockId: string; busy: boolean; onRollback: () => void }
}

function isProcessEntry(
  entry: TurnProcessTimelineEntry
): entry is Extract<TurnProcessTimelineEntry, { kind: 'process' }> {
  return entry.kind === 'process'
}

function isRuntimeErrorEntry(
  entry: TurnProcessTimelineEntry
): entry is Extract<TurnProcessTimelineEntry, { kind: 'runtime_error' }> {
  return entry.kind === 'runtime_error'
}

/**
 * Renders a turn that contains guided user inputs. User bubbles keep their
 * chronological position and every process run between two user messages folds
 * independently, so collapsing work never hides or reorders an input bubble.
 */
export function OrderedTurnTimeline({
  entries,
  isProcessing,
  expanded,
  onToggle,
  durationMs,
  reasoningDurationMs,
  workspaceRoot,
  viewportRef,
  allowThreadActions,
  allowRecoveryContinue,
  onContinueInterrupted,
  onOpenChildThread,
  onCancelToolCall,
  forkAction,
  rollbackAction
}: OrderedTurnTimelineProps): ReactElement {
  const foldableSegmentIds = entries.flatMap((entry) =>
    entry.kind === 'process' && entry.segment.entries.some(isProcessEntry)
      ? [entry.segment.id]
      : []
  )
  const lastFoldableSegmentId = foldableSegmentIds[foldableSegmentIds.length - 1]
  const runtimeErrorIds = entries.flatMap((entry) =>
    entry.kind === 'process'
      ? entry.segment.entries.filter(isRuntimeErrorEntry).map((item) => item.block.id)
      : []
  )
  const lastRuntimeErrorId = runtimeErrorIds[runtimeErrorIds.length - 1]
  const reasoningSectionCount = entries.reduce(
    (count, entry) =>
      entry.kind === 'process'
        ? count + entry.segment.entries.filter(
            (item) => isProcessEntry(item) && item.section.kind === 'reasoning'
          ).length
        : count,
    0
  )

  return (
    <>
      {entries.map((entry) => {
        if (entry.kind === 'user') {
          return (
            <MessageBubble
              key={`user-${entry.block.id}`}
              block={entry.block}
              allowThreadActions={allowThreadActions}
            />
          )
        }
        if (entry.kind === 'answer') {
          const fork = forkAction?.blockId === entry.block.id ? forkAction : undefined
          const rollback =
            rollbackAction?.blockId === entry.block.id ? rollbackAction : undefined
          return (
            <MessageBubble
              key={`answer-${entry.block.id}`}
              block={entry.block}
              allowThreadActions={allowThreadActions}
              forkAction={fork ? { busy: fork.busy, onFork: fork.onFork } : undefined}
              rollbackAction={
                rollback
                  ? { busy: rollback.busy, onRollback: rollback.onRollback }
                  : undefined
              }
            />
          )
        }

        const { segment } = entry
        const sections = segment.entries.filter(isProcessEntry)
        const runtimeErrors = segment.entries.filter(isRuntimeErrorEntry)
        const showFold = !isProcessing && sections.length > 0
        const showSections = sections.length > 0 && (isProcessing || expanded)

        return (
          <div key={segment.id} className="flex min-w-0 flex-col gap-1">
            {showFold ? (
              <WorkMetaRow
                processing={false}
                durationMs={segment.id === lastFoldableSegmentId ? durationMs : undefined}
                expanded={expanded}
                onToggle={onToggle}
              />
            ) : null}
            {showSections ? (
              <div className="flex flex-col gap-1">
                {sections.map((item) => (
                  <ProcessSectionRow
                    key={item.section.id}
                    section={item.section}
                    processing={isProcessing}
                    reasoningDurationMs={reasoningDurationMs}
                    singleReasoningSection={reasoningSectionCount === 1}
                    workspaceRoot={workspaceRoot}
                    viewportRef={viewportRef}
                    onOpenChildThread={onOpenChildThread}
                    onCancelToolCall={onCancelToolCall}
                    allowThreadActions={allowThreadActions}
                  />
                ))}
              </div>
            ) : null}
            {runtimeErrors.map((item) => (
              <TimelineRuntimeError
                key={item.block.id}
                block={item.block}
                onContinue={
                  !isProcessing &&
                  allowThreadActions &&
                  allowRecoveryContinue &&
                  item.block.id === lastRuntimeErrorId
                    ? onContinueInterrupted
                    : undefined
                }
              />
            ))}
          </div>
        )
      })}
    </>
  )
}
