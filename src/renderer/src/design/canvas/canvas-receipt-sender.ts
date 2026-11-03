import { kunThreadCanvasReceiptsPath } from '@shared/kun-endpoints'
import { rendererRuntimeClient } from '../../agent/runtime-client'

export type CanvasReceiptError = {
  code: string
  message: string
  suggestion?: string
}

export type CanvasReceiptGeneratedFile = {
  name: string
  relativePath: string
  absolutePath?: string
  mimeType: 'image/png' | 'image/svg+xml'
  byteSize: number
}

/**
 * Two-phase design tool receipt: after a canvas turn is applied, tell the
 * Kun loop whether the renderer actually applied (or rejected) the design
 * operations so the model sees the real outcome on its next request.
 *
 * The loop waits for this receipt (up to CANVAS_RECEIPT_TIMEOUT_MS) and
 * finalizes the accepted tool result as applied/failed, or `unverified` on
 * timeout. Fire-and-forget: a missing bridge or failed POST is non-fatal, but is logged.
 */
export function sendCanvasTurnReceipt(input: {
  threadId: string
  turnId: string
  receiptKey?: string
  affectedIds: readonly string[]
  errors: readonly CanvasReceiptError[]
  generatedFiles?: readonly CanvasReceiptGeneratedFile[]
}): void {
  const { threadId, turnId } = input
  if (!threadId || !turnId) return
  const affectedIds = [...input.affectedIds]
  const errors = [...input.errors]
  const generatedFiles = [...(input.generatedFiles ?? [])]
  // A keyed receipt also acknowledges valid no-op tools such as
  // design_create_board. Without it the loop would wait for the whole turn,
  // while the renderer's old turn-level receipt is only sent after that turn.
  if (!input.receiptKey && affectedIds.length === 0 && errors.length === 0) return
  // Test/headless environments do not expose the preload bridge.
  if (typeof window === 'undefined' || !window.kunGui) return
  void rendererRuntimeClient.runtimeRequest(
    kunThreadCanvasReceiptsPath(threadId),
    'POST',
    JSON.stringify({
      turnId,
      ...(input.receiptKey ? { receiptKey: input.receiptKey } : {}),
      status: errors.length > 0 ? 'failed' : 'applied',
      ...(errors.length > 0 ? { errors } : {}),
      ...(affectedIds.length > 0 ? { affectedIds } : {}),
      ...(generatedFiles.length > 0 ? { generatedFiles } : {})
    })
  ).catch((error: unknown) => {
    // A rejected receipt leaves the loop waiting out its timeout, so make the
    // failure visible instead of swallowing it.
    console.warn('[design] canvas receipt was not delivered', {
      receiptKey: input.receiptKey,
      error: error instanceof Error ? error.message : String(error)
    })
  })
}
