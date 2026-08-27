import type { ChatState } from '../../store/chat-store-types'
import { threadHasPendingRuntimeWork } from '../../store/chat-store-runtime-helpers'
import {
  dispatchNextPendingScreen,
  type PendingScreenGeneration
} from './canvas-design-replay-support'
import type { CanvasDocument } from './canvas-types'
import type { ToolBlock } from '../../agent/types'

export type CanvasTurnDrainContext = {
  pendingScreens: PendingScreenGeneration[]
  pendingSvgToolBlocks: Map<string, ToolBlock>
  svgSourceTurnIds: Map<string, string>
  isDisposed: () => boolean
  getChatState: () => Pick<ChatState, 'currentTurnId' | 'busy' | 'blocks'>
  getDocument: () => CanvasDocument
  getHtmlArtifactIds: () => Set<string>
  ensureBarrier: (turnId: string) => { pendingScreenIds: Set<string> } | null
  commitWatermarks: () => void
  selectShape: (shapeId: string) => void
  onScreenCreated?: (
    shapeId: string,
    userPrompt: string,
    brief?: string
  ) => boolean | void | Promise<boolean | void>
  applySvgToolBlock: (block: ToolBlock, allowLegacy?: boolean, sourceTurnId?: string) => Promise<void>
  scheduleScreenDrain: (delay?: number) => void
  scheduleSvgDrain: (delay?: number) => void
}

/** Drain queued SVG tool blocks once the thread is idle. */
export function drainPendingSvgBlocks(context: CanvasTurnDrainContext): void {
  if (context.pendingSvgToolBlocks.size === 0) return
  const chatState = context.getChatState()
  if (
    chatState.currentTurnId ||
    chatState.busy ||
    threadHasPendingRuntimeWork(chatState.blocks)
  ) {
    context.scheduleSvgDrain()
    return
  }
  const blocks = [...context.pendingSvgToolBlocks.values()]
  context.pendingSvgToolBlocks.clear()
  for (const block of blocks) {
    void context.applySvgToolBlock(block, true, context.svgSourceTurnIds.get(block.id) ?? '')
  }
}

/**
 * Kick off the next queued screen's HTML generation — but only while the
 * thread is fully idle, so the per-screen turns run strictly one at a time.
 * Turn completion and busy/currentTurnId clearing can land in separate store
 * ticks, so this function re-schedules itself instead of consuming too early.
 */
export async function drainPendingScreens(context: CanvasTurnDrainContext): Promise<void> {
  if (context.pendingScreens.length === 0) return
  const chatState = context.getChatState()
  const pendingRuntimeWork = threadHasPendingRuntimeWork(chatState.blocks)
  const result = await dispatchNextPendingScreen({
    pendingScreens: context.pendingScreens,
    document: context.getDocument(),
    currentTurnId: chatState.currentTurnId,
    busy: chatState.busy,
    pendingRuntimeWork,
    htmlArtifactIds: context.getHtmlArtifactIds(),
    onDrop: (dropped) => {
      if (!dropped.sourceTurnId) return
      context.ensureBarrier(dropped.sourceTurnId)?.pendingScreenIds.delete(dropped.shapeId)
      context.commitWatermarks()
    },
    onDispatch: (pending) => {
      context.selectShape(pending.shapeId)
      return context.onScreenCreated?.(pending.shapeId, pending.userPrompt, pending.brief) ?? false
    }
  })
  if (context.isDisposed()) return
  if (result.status === 'failed' && (result.pending?.attempts ?? 0) < 2) {
    context.scheduleScreenDrain(400)
    return
  }
  if (result.status === 'blocked') {
    if (
      context.pendingScreens.length > 0 &&
      (chatState.currentTurnId || chatState.busy || pendingRuntimeWork)
    ) {
      context.scheduleScreenDrain()
    }
    return
  }
  const dispatched = result.status === 'dispatched' ? result.pending : undefined
  if (dispatched?.sourceTurnId) {
    context.ensureBarrier(dispatched.sourceTurnId)?.pendingScreenIds.delete(dispatched.shapeId)
    context.commitWatermarks()
  }
}
