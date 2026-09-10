import type { AgentProvider } from '../agent/types'
import { turnAdmissionOutcomeMayBeUnknown } from './chat-store-thread-actions-support'
import { fetchRuntimeQueuedTurnsBestEffort } from './queued-message-persistence'

type Admission = Awaited<ReturnType<AgentProvider['sendUserMessage']>>

/** A different active turn is never evidence that this request was admitted. */
export async function confirmQueueAdmission(input: {
  provider: AgentProvider
  threadId: string
  clientRequestId: string
  send: () => Promise<Admission>
  wait?: (ms: number) => Promise<void>
}): Promise<Admission & { retired?: boolean }> {
  const wait = input.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  for (let attempt = 0; ; attempt++) {
    try {
      return await input.send()
    } catch (error) {
      if (!turnAdmissionOutcomeMayBeUnknown(error)) throw error
      const queue = await fetchRuntimeQueuedTurnsBestEffort(input.provider, input.threadId)
      const receipt = queue?.find((row) => row.clientRequestId === input.clientRequestId)
      if (receipt && receipt.status !== 'admission_pending') {
        if (receipt.status === 'failed') {
          throw new Error(JSON.stringify({ code: receipt.terminalCode ?? 'queued_turn_failed',
            message: 'The queued turn failed. Your input has been kept for retry.' }))
        }
        return {
          threadId: input.threadId, turnId: receipt.turnId, userMessageItemId: `item_${receipt.turnId}_user`,
          ...(receipt.status && receipt.status !== 'queued' ? { retired: true } : { status: 'queued' as const })
        }
      }
      if (attempt >= 4) throw error
      // Pending or absent: retry the identical request even while an earlier
      // turn is running. The host repairs its own two-phase admission.
      await wait(Math.min(5000, 1000 * 2 ** attempt))
    }
  }
}
