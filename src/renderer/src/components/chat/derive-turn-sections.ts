import type { ChatBlock, ToolBlock } from '../../agent/types'
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

export type TurnAssistantBlock = Extract<ChatBlock, { kind: 'assistant' }>

export type TurnSections = {
  processBlocks: ChatBlock[]
  assistantContentBlocks: TurnAssistantBlock[]
  componentPrototypeBlocks: ToolBlock[]
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
  liveProcessText: string
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
 * Index of the last assistant block that carries visible (non-think) content.
 * That single segment is the turn's final answer bubble; everything before it
 * — including any consecutive narration segments — belongs inside the
 * collapsed process timeline. Returns -1 when the turn has no assistant text.
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
 * Pure derivation of a turn's three view slices:
 *  - `processBlocks`: chronological reasoning/tool/compaction/approval
 *    trace, including in-flight assistant output while a turn is processing.
 *  - `assistantContentBlocks`: assistant content that should render as the
 *    visible message body once it is no longer part of the active work timeline.
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
  const processBlocks: ChatBlock[] = []
  const assistantContentBlocks: TurnAssistantBlock[] = []
  // Only the SINGLE last assistant text segment is the visible answer bubble
  // (rendered outside the collapsed timeline). Every earlier "我先看看…" preface
  // / intermediate narration stays inside 已处理 — even consecutive trailing
  // segments. While processing, nothing is surfaced as the final body yet;
  // everything is part of the live trace.
  const finalAssistantContentIndex = isProcessing
    ? -1
    : findLastAssistantContentIndex(turn.blocks)

  for (const [index, block] of turn.blocks.entries()) {
    if (block.kind === 'assistant') {
      const split = splitThink(block.text)
      if (split.think) {
        processBlocks.push({ kind: 'reasoning', id: `${block.id}-think`, text: split.think })
      }
      if (split.content.trim()) {
        const contentBlock: TurnAssistantBlock = { ...block, text: split.content }
        if (index === finalAssistantContentIndex) {
          assistantContentBlocks.push(contentBlock)
        } else {
          processBlocks.push(contentBlock)
        }
      }
      continue
    }
    if (isProcessBlock(block)) {
      processBlocks.push(block)
    }
  }

  if (liveProcessText.trim()) {
    processBlocks.push({ kind: 'reasoning', id: 'live-reasoning', text: liveProcessText })
  }
  // The streaming assistant text is rendered as a separate MessageBubble by
  // MessageTimeline (see `<MessageBubble block={{ kind: 'assistant',
  // id: 'live-assistant', text: liveContent }} />`). Avoid adding it to
  // processBlocks here — that would show the same content twice (once in
  // the WorkMetaRow process area, once in the regular message flow) until
  // turn_completed drains the live block. Reasoning, by contrast, is
  // process-only and stays here.

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

  return { processBlocks, assistantContentBlocks, componentPrototypeBlocks, generatedFileBlocks, turnFileChanges }
}
