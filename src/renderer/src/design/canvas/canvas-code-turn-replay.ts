import type { ChatBlock, ToolBlock } from '../../agent/types'
import type { CanvasDocument } from './canvas-types'
import {
  codeCanvasReplayKey,
  userBlockHasDesignDocumentTarget
} from './canvas-design-turn-replay'

export type DurableCodeCanvasTurn = {
  userBlockId: string
  turnId: string
  blocks: readonly ChatBlock[]
  startIndex: number
  endIndex: number
}

function codeCanvasTurnId(
  user: ChatBlock,
  blocks: readonly ChatBlock[]
): string {
  return user.turnId?.trim() || blocks.find((block) => block.turnId?.trim())?.turnId || user.id
}

export function durableCodeCanvasTurns(blocks: readonly ChatBlock[]): DurableCodeCanvasTurn[] {
  const turns: DurableCodeCanvasTurn[] = []
  for (let index = 0; index < blocks.length; index += 1) {
    const user = blocks[index]
    if (user.kind !== 'user') continue
    let end = index + 1
    while (end < blocks.length && blocks[end].kind !== 'user') end += 1
    // Code and Design turns share one conversation, but their canvas hosts do
    // not share persistence. Never replay an explicitly targeted Design turn
    // into the lightweight per-thread Code whiteboard.
    if (userBlockHasDesignDocumentTarget(user)) {
      index = end - 1
      continue
    }
    const turnBlocks = blocks.slice(index, end)
    turns.push({
      userBlockId: user.id,
      turnId: codeCanvasTurnId(user, turnBlocks),
      blocks: turnBlocks,
      startIndex: index,
      endIndex: end
    })
    index = end - 1
  }
  return turns
}

function visibleObjectCount(document: CanvasDocument): number {
  return Object.keys(document.objects).filter((id) => id !== document.rootId).length
}

function lastLegacyAppliedToolIndex(
  blocks: readonly ChatBlock[],
  document: CanvasDocument
): number {
  const labels = new Set((document.operationJournal ?? []).map((entry) => entry.label))
  let lastApplied = -1
  blocks.forEach((block, index) => {
    if (block.kind === 'tool' && labels.has(`tool:${block.id}:0`)) lastApplied = index
  })
  return lastApplied
}

/**
 * Replays renderer-owned tool results that were missed while a per-thread Code
 * canvas was loading. New results use durable replay keys. For documents saved
 * before replay keys existed, the operation journal supplies a migration
 * boundary so historical add operations are not duplicated.
 */
export function replayDurableCodeCanvasToolBlocks(options: {
  threadId: string
  blocks: readonly ChatBlock[]
  document: CanvasDocument
  onTurnStart: () => void
  onToolBlock: (
    block: ToolBlock,
    turnBlocks: readonly ChatBlock[],
    replayKey: string,
    turnId: string
  ) => void
  onTurnComplete: (turnId: string) => void
}): void {
  const turns = durableCodeCanvasTurns(options.blocks)
  if (turns.length === 0) return
  const watermark = options.document.rendererReplayWatermarkTurnId
  const watermarkIndex = watermark
    ? turns.findIndex((turn) => turn.turnId === watermark)
    : -1
  let pendingTurns = watermarkIndex >= 0 ? turns.slice(watermarkIndex + 1) : turns
  let minimumBlockIndex = -1

  if (watermarkIndex < 0) {
    minimumBlockIndex = lastLegacyAppliedToolIndex(options.blocks, options.document)
    if (minimumBlockIndex < 0 && visibleObjectCount(options.document) > 0) {
      // An unjournaled legacy document cannot be safely rebuilt from its full
      // history. The latest completed turn is the bounded recovery candidate.
      pendingTurns = turns.slice(-1)
      minimumBlockIndex = pendingTurns[0].startIndex - 1
    }
  }

  for (const turn of pendingTurns) {
    const tools = turn.blocks.filter((block): block is ToolBlock => block.kind === 'tool')
    const actionable = tools.filter((block) =>
      options.blocks.indexOf(block) > minimumBlockIndex
    )
    if (actionable.length === 0 && turn.endIndex <= minimumBlockIndex + 1) continue
    options.onTurnStart()
    for (const block of actionable) {
      options.onToolBlock(
        block,
        turn.blocks,
        codeCanvasReplayKey({
          threadId: options.threadId,
          turnId: turn.turnId,
          source: `tool:${block.id}`
        }),
        turn.turnId
      )
    }
    options.onTurnComplete(turn.turnId)
  }
}

/**
 * Rechecks structured PPT results independently of the coarse renderer turn
 * watermark. PPT projections have their own workflow/child/revision fence, so
 * scanning the durable history is safe and repairs a review result that arrived
 * after its turn watermark was persisted.
 */
export function replayDurablePptCanvasToolBlocks(options: {
  threadId: string
  blocks: readonly ChatBlock[]
  onToolBlock: (
    block: ToolBlock,
    turnBlocks: readonly ChatBlock[],
    replayKey: string,
    turnId: string
  ) => void
}): void {
  for (const turn of durableCodeCanvasTurns(options.blocks)) {
    for (const block of turn.blocks) {
      if (block.kind !== 'tool' || block.status !== 'success' || block.meta?.toolName !== 'ppt_agent') continue
      options.onToolBlock(
        block,
        turn.blocks,
        codeCanvasReplayKey({
          threadId: options.threadId,
          turnId: turn.turnId,
          source: `ppt:${block.id}`
        }),
        turn.turnId
      )
    }
  }
}
