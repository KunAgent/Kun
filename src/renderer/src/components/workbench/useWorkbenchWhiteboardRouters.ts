import type { ChatBlock, NormalizedThread } from '../../agent/types'
import type { AppRoute } from '../../store/chat-store-types'
import { useWorkbenchExcalidrawRouter } from './useWorkbenchExcalidrawRouter'
import { useWorkbenchPptWhiteboardRouter } from './useWorkbenchPptWhiteboardRouter'

/** Workbench-level routers that fulfill whiteboard tool requests the mounted
 * board surfaces cannot serve themselves. */
export function useWorkbenchWhiteboardRouters(input: {
  activeThreadId: string | null
  blocks: ChatBlock[]
  route: AppRoute
  threads: NormalizedThread[]
  workspaceRoot: string
}): void {
  useWorkbenchPptWhiteboardRouter(input)
  useWorkbenchExcalidrawRouter(input)
}
