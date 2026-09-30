import type { ThreadRecord } from '../contracts/threads.js'
import type { Turn } from '../contracts/turns.js'
import type { TurnItem } from '../contracts/items.js'
import type { ModelToolSpec } from '../ports/model-client.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import { imMessageServiceBinding } from '../rooms/room-im-message-tool.js'
import { roomRunId } from '../rooms/room-run-recording.js'
import { PRIVATE_PUBLICATION_TOOL_NAMES, privateDeliveryState } from '../rooms/room-im-delivery.js'

/** Per-step delivery gate; the persisted Room run controls whether this is a fresh user request. */
export async function preparePrivateDelivery(input: {
  thread: ThreadRecord
  turn: Turn
  threadStore: ThreadStore
  history: readonly TurnItem[]
  planningTools: readonly ModelToolSpec[]
  hardRequiredToolName?: string
  forceFinalAnswerRecovery: boolean
  boundedFinalSynthesis: boolean
  nowMs: number
}) {
  const scope = input.thread.roomContext
  const privateRoom = scope?.kind === 'conversation' && Boolean(scope.participantAgentId)
  const run = privateRoom && input.turn.clientRequestId
    ? await imMessageServiceBinding(input.threadStore)?.store.get<RoomRunRecord>('room_run',
      roomRunId(scope.roomId, input.turn.clientRequestId))
    : null
  const communicationRequired = run?.value.threadId === input.thread.id && run.value.turnId === input.turn.id &&
    run.value.communicationRequired === true
  const finalResponseRequired = run?.value.threadId === input.thread.id && run.value.turnId === input.turn.id &&
    run.value.finalResponseRequired === true
  const delivery = privateRoom
    ? privateDeliveryState(input.history, input.turn.id, input.nowMs, communicationRequired, run?.value)
    : undefined
  const gate = communicationRequired && !input.forceFinalAnswerRecovery && !input.boundedFinalSynthesis
    ? delivery?.gate ?? 'none' : 'none'
  const requiredToolName = gate === 'none' ? input.hardRequiredToolName : undefined
  const requestToolSpecs = gate !== 'none'
    ? input.planningTools.filter((tool) => PRIVATE_PUBLICATION_TOOL_NAMES.includes(
        tool.name as typeof PRIVATE_PUBLICATION_TOOL_NAMES[number]))
    : requiredToolName
      ? input.planningTools.filter((tool) => tool.name === requiredToolName)
      : input.forceFinalAnswerRecovery || input.boundedFinalSynthesis
        ? []
        : [...input.planningTools]
  return { delivery, communicationRequired, finalResponseRequired, gate, requiredToolName, requestToolSpecs }
}
