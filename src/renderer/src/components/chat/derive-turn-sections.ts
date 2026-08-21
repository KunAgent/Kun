import type { ChatBlock, ToolBlock } from '../../agent/types'
import { dedupeTimelineTextBlocks } from '../../agent/timeline-text-blocks'
import {
  extractDiffFilePath,
  extractUnifiedDiffText,
  formatFilePathForDisplay,
} from '../../lib/diff-stats'
import {
  isProcessBlock,
  splitThink,
  type Turn
} from './message-timeline-turns'
import {
  groupProcessSections,
  type ProcessSection
} from './message-timeline-process-grouping'

export type TurnAssistantBlock = Extract<ChatBlock, { kind: 'assistant' }>
export type TurnRuntimeErrorBlock = Extract<ChatBlock, { kind: 'system' }> & { runtimeError: true }

export type TurnProcessTimelineEntry =
  | { kind: 'process'; section: ProcessSection }
  | { kind: 'runtime_error'; block: TurnRuntimeErrorBlock }

export type TurnSections = {
  processBlocks: ChatBlock[]
  /** Active-turn process blocks plus runtime errors in their original order. */
  processTimelineBlocks: ChatBlock[]
  assistantContentBlocks: TurnAssistantBlock[]
  runtimeErrorBlocks: TurnRuntimeErrorBlock[]
  runtimeErrorsBeforeFinalContent: TurnRuntimeErrorBlock[]
  runtimeErrorsAfterFinalContent: TurnRuntimeErrorBlock[]
  componentPrototypeBlocks: ToolBlock[]
  conversationVisualizationBlocks: ToolBlock[]
  generatedFileBlocks: ToolBlock[]
  turnFileChanges: ToolBlock[]
}

type ResolvedFileChangeBlock = ToolBlock & {
  detail: string
  filePath: string
}

type DeriveTurnSectionsInput = {
  turn: Turn
  isProcessing: boolean
  /** Current reasoning stream, appended to the active chronological timeline. */
  liveProcessText: string
  /** Current assistant stream, appended to the active chronological timeline. */
  liveContent: string
  workspaceRoot: string
}

function fileChangeGroupKey(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/\/+$/, '')
}

function mergeFileChangeBlocks(changes: ResolvedFileChangeBlock[]): ToolBlock[] {
  const merged: ResolvedFileChangeBlock[] = []
  const indexByPath = new Map<string, number>()

  for (const change of changes) {
    const key = fileChangeGroupKey(change.filePath)
    const existingIndex = indexByPath.get(key)
    if (existingIndex === undefined) {
      indexByPath.set(key, merged.length)
      merged.push(change)
      continue
    }

    const existing = merged[existingIndex]
    merged[existingIndex] = {
      ...existing,
      detail: [existing.detail, change.detail].filter(Boolean).join('\n\n')
    }
  }

  return merged
}

function metaArrayLength(meta: Record<string, unknown> | undefined, key: string): number {
  const value = meta?.[key]
  return Array.isArray(value) ? value.length : 0
}

function hasGeneratedFiles(block: ToolBlock): boolean {
  return (
    block.status === 'success' &&
    (metaArrayLength(block.meta, 'attachments') > 0 || metaArrayLength(block.meta, 'generatedFiles') > 0)
  )
}

/**
 * Returns the last persisted assistant block with visible non-thinking text.
 * After settlement this one block remains outside the folded process as the
 * final answer. Every earlier assistant update stays in chronological work.
 */
function findLastAssistantContentIndex(blocks: ChatBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]
    if (block.kind === 'assistant' && splitThink(block.text).content.trim()) {
      return index
    }
  }
  return -1
}

/**
 * Preserve a live turn's chronological position around durable runtime errors
 * while retaining the existing grouping for uninterrupted process runs.
 */
export function groupTurnProcessTimeline(
  blocks: ChatBlock[]
): TurnProcessTimelineEntry[] {
  const entries: TurnProcessTimelineEntry[] = []
  let pendingProcessBlocks: ChatBlock[] = []

  const flushProcessBlocks = (): void => {
    if (pendingProcessBlocks.length === 0) return
    entries.push(...groupProcessSections(pendingProcessBlocks).map((section) => ({
      kind: 'process' as const,
      section
    })))
    pendingProcessBlocks = []
  }

  for (const block of blocks) {
    if (block.kind === 'system' && block.runtimeError === true) {
      flushProcessBlocks()
      entries.push({ kind: 'runtime_error', block: block as TurnRuntimeErrorBlock })
    } else {
      pendingProcessBlocks.push(block)
    }
  }
  flushProcessBlocks()
  return entries
}

/**
 * Pure derivation of a turn's three view slices:
 *  - `processBlocks`: chronological assistant/reasoning/tool/compaction/
 *    approval trace. It contains the whole active stream while processing and
 *    all intermediate output after the turn settles.
 *  - `assistantContentBlocks`: the single final assistant text shown outside
 *    the folded process after settlement.
 *  - `turnFileChanges`: successful file_change tool blocks whose detail
 *    is a unified diff, with paths normalised for display.
 *
 * Pulled out of `MessageTurn` so the derivation is testable in isolation
 * and the component body stays focused on rendering.
 */
export function deriveTurnSections({
  turn,
  isProcessing,
  liveProcessText,
  liveContent,
  workspaceRoot
}: DeriveTurnSectionsInput): TurnSections {
  const timelineBlocks = dedupeTimelineTextBlocks(turn.blocks)
  const processBlocks: ChatBlock[] = []
  const processTimelineBlocks: ChatBlock[] = []
  const assistantContentBlocks: TurnAssistantBlock[] = []
  const runtimeErrorBlocks: TurnRuntimeErrorBlock[] = []
  const runtimeErrorsBeforeFinalContent: TurnRuntimeErrorBlock[] = []
  const runtimeErrorsAfterFinalContent: TurnRuntimeErrorBlock[] = []
  const finalAssistantContentIndex = isProcessing
    ? -1
    : findLastAssistantContentIndex(timelineBlocks)

  for (const [index, block] of timelineBlocks.entries()) {
    if (block.kind === 'system' && block.runtimeError === true) {
      const runtimeErrorBlock = block as TurnRuntimeErrorBlock
      runtimeErrorBlocks.push(runtimeErrorBlock)
      if (isProcessing) {
        processTimelineBlocks.push(runtimeErrorBlock)
      } else if (finalAssistantContentIndex >= 0 && index < finalAssistantContentIndex) {
        runtimeErrorsBeforeFinalContent.push(runtimeErrorBlock)
      } else {
        runtimeErrorsAfterFinalContent.push(runtimeErrorBlock)
      }
      continue
    }
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think) {
        const reasoningBlock: ChatBlock = {
          kind: 'reasoning',
          id: `${block.id}-think`,
          turnId: block.turnId,
          createdAt: block.createdAt,
          text: split.think
        }
        processBlocks.push(reasoningBlock)
        processTimelineBlocks.push(reasoningBlock)
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        if (index === finalAssistantContentIndex) {
          assistantContentBlocks.push(contentBlock)
        } else {
          processBlocks.push(contentBlock)
          processTimelineBlocks.push(contentBlock)
        }
      }
      continue
    }
    if (isProcessBlock(block)) {
      processBlocks.push(block)
      processTimelineBlocks.push(block)
    }
  }

  // Live values represent the current tail after all persisted blocks. Keeping
  // them in this same projection makes text, thought, and tool work read as one
  // downward timeline instead of splitting assistant output into another lane.
  if (isProcessing && liveProcessText.trim()) {
    const liveReasoningBlock: ChatBlock = {
      kind: 'reasoning',
      id: 'live-reasoning',
      text: liveProcessText
    }
    processBlocks.push(liveReasoningBlock)
    processTimelineBlocks.push(liveReasoningBlock)
  }
  if (isProcessing && liveContent.trim()) {
    const liveAssistantBlock: ChatBlock = {
      kind: 'assistant',
      id: 'live-assistant',
      text: liveContent
    }
    processBlocks.push(liveAssistantBlock)
    processTimelineBlocks.push(liveAssistantBlock)
  }

  const turnFileChanges: ToolBlock[] = isProcessing
    ? []
    : mergeFileChangeBlocks(turn.blocks.flatMap((block): ResolvedFileChangeBlock[] => {
        if (
          !(block.kind === 'tool' && block.toolKind === 'file_change' && block.status === 'success')
        ) {
          return []
        }

        const detailText = extractUnifiedDiffText(block.detail)
        if (!detailText) return []

        const resolvedFilePath = formatFilePathForDisplay(
          extractDiffFilePath(detailText, block.filePath),
          workspaceRoot
        )
        if (!resolvedFilePath) return []

        return [{ ...block, detail: detailText, filePath: resolvedFilePath }]
      }))

  const generatedFileBlocks: ToolBlock[] = turn.blocks.filter(
    (block): block is ToolBlock => block.kind === 'tool' && hasGeneratedFiles(block)
  )

  const componentPrototypeBlocks: ToolBlock[] = turn.blocks.filter((block): block is ToolBlock => (
    block.kind === 'tool' &&
    block.meta?.toolName === 'design_component' &&
    Boolean(block.meta.componentPrototype)
  ))
  const conversationVisualizationBlocks: ToolBlock[] = turn.blocks.filter((block): block is ToolBlock => (
    block.kind === 'tool' &&
    block.meta?.toolName === 'show_visualization' &&
    Boolean(block.meta.conversationVisualization)
  ))

  return {
    processBlocks,
    processTimelineBlocks,
    assistantContentBlocks,
    runtimeErrorBlocks,
    runtimeErrorsBeforeFinalContent,
    runtimeErrorsAfterFinalContent,
    componentPrototypeBlocks,
    conversationVisualizationBlocks,
    generatedFileBlocks,
    turnFileChanges
  }
}
