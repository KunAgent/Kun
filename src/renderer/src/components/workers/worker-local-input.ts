import type { AgentProvider } from '../../agent/types'
import { confirmQueueAdmission } from '../../store/queue-admission-recovery'

type Admission = Awaited<ReturnType<AgentProvider['sendUserMessage']>>

/**
 * Worker input is addressed to the worker thread itself. Control is
 * acknowledged by the host before admission; a busy turn enters Kun's
 * durable queue. No active-thread or main composer state is involved.
 */
export async function sendWorkerLocalInput(input: {
  provider: AgentProvider
  workerId: string
  text: string
  attachmentIds: string[]
  clientRequestId: string
  wait?: (ms: number) => Promise<void>
  onControlAcquired?: () => void
}): Promise<Admission & { retired?: boolean }> {
  if (!input.provider.controlTeamWorker) {
    throw new Error('Worker control is unavailable.')
  }
  await input.provider.controlTeamWorker(input.workerId, 'take-over')
  input.onControlAcquired?.()
  return confirmQueueAdmission({
    provider: input.provider,
    threadId: input.workerId,
    clientRequestId: input.clientRequestId,
    ...(input.wait ? { wait: input.wait } : {}),
    send: () => input.provider.sendUserMessage(input.workerId, input.text, {
      clientRequestId: input.clientRequestId,
      enqueueIfBusy: true,
      agentSurface: 'code',
      ...(input.attachmentIds.length ? { attachmentIds: input.attachmentIds } : {})
    })
  })
}
