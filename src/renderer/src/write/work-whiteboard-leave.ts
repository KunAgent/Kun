import { flushPendingCanvasDocuments } from '../design/canvas/canvas-persistence'
import { flushPendingExcalidrawScenes } from '../whiteboard/excalidraw-persistence'
import type { CanvasEngine } from '../whiteboard/canvas-engine'

export type WorkWhiteboardLeaveResult = { ok: true } | { ok: false; message: string }

/**
 * Writes any debounced canvas change before the surface unmounts. Leaving a
 * board must not rely on the unmount cleanup, because that cannot report a
 * failure back to the user.
 */
export async function flushWorkWhiteboardPersistence(
  workspaceRoot: string,
  engine: CanvasEngine
): Promise<WorkWhiteboardLeaveResult> {
  try {
    if (engine === 'excalidraw') await flushPendingExcalidrawScenes(workspaceRoot)
    else await flushPendingCanvasDocuments(workspaceRoot)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
