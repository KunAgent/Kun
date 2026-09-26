/**
 * Bridges Kun's `user_input` tool to the active client for delegated harnesses
 * (docs/ade/05 §3.2): persist the request item, publish the events clients
 * render, wait on the gate, then mark it resolved. Shared by the Agent SDK MCP
 * adapter, the Cursor SDK custom-tools adapter, and the Kun Tools MCP server.
 */
import type { SessionStore } from '../ports/session-store.js'
import type { TurnService } from '../services/turn-service.js'
import type { RuntimeEventRecorder } from '../services/runtime-event-recorder.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type {
  UserInputGate,
  UserInputRequest,
  UserInputResolution
} from '../ports/user-input-gate.js'
import { makeUserInputItem } from '../domain/item.js'
import {
  armUserInputTimeout,
  awaitAbortableGate,
  userInputRequestWithDeadline
} from '../services/interactive-gate.js'
import { settleUserInputResolution } from '../services/user-input-settlement.js'

export type KunToolUserInputDeps = {
  userInputGate?: UserInputGate
  turns: Pick<TurnService, 'applyItem' | 'updateItem'>
  events: RuntimeEventRecorder
  sessionStore: SessionStore
  nowIso: () => string
}

/**
 * Await a user-input gate resolution, cancelling the pending request if the
 * turn aborts first. Mirrors the native loop's waitForUserInput handling.
 */
export function waitForGate(
  gate: UserInputGate,
  request: UserInputRequest,
  signal: AbortSignal,
  armedPending?: Promise<UserInputResolution>
): Promise<UserInputResolution> {
  const pending = armedPending ?? gate.request(request)
  if (signal.aborted) {
    gate.resolve(request.id, { status: 'cancelled' })
    return Promise.resolve({ status: 'cancelled' })
  }
  return awaitAbortableGate(
    pending,
    signal,
    () => { gate.resolve(request.id, { status: 'cancelled' }) },
    'cancelled while awaiting user input'
  )
}

/**
 * Build the ToolHostContext `awaitUserInput` callback for one turn. Undefined
 * when no gate is wired — the tool then stays unadvertised (its
 * shouldAdvertise checks for awaitUserInput).
 */
export function makeKunAwaitUserInput(
  deps: KunToolUserInputDeps,
  threadId: string,
  turnId: string,
  signal: AbortSignal
): ToolHostContext['awaitUserInput'] {
  const gate = deps.userInputGate
  if (!gate) return undefined
  return async (input): Promise<UserInputResolution> => {
    const request: UserInputRequest = {
      id: input.id,
      threadId,
      turnId,
      itemId: input.itemId,
      prompt: input.prompt,
      questions: input.questions,
      ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
    }
    // Arm first so an event subscriber can immediately submit a response.
    const pending = gate.request(userInputRequestWithDeadline(request))
    const item = makeUserInputItem({
      id: input.itemId,
      threadId,
      turnId,
      inputId: input.id,
      prompt: input.prompt,
      questions: input.questions,
      ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
    })
    let requestedSeq: number | undefined
    try {
      await deps.turns.applyItem(threadId, item)
      requestedSeq = (
        await deps.events.record({
          kind: 'user_input_requested',
          threadId,
          turnId,
          itemId: item.id,
          inputId: input.id,
          status: 'pending',
          prompt: input.prompt,
          questions: input.questions,
          ...(input.timeoutSeconds !== undefined ? { timeoutSeconds: input.timeoutSeconds } : {})
        })
      ).seq
    } catch (error) {
      gate.resolve(input.id, { status: 'cancelled' })
      void pending.catch(() => undefined)
      throw error
    }
    const disarmTimeout = armUserInputTimeout(
      (resolution) => gate.resolve(input.id, resolution),
      input.id,
      input.timeoutSeconds
    )
    let resolution: UserInputResolution
    try {
      resolution = await waitForGate(gate, request, signal, pending)
    } catch {
      resolution = { status: 'cancelled' }
    } finally {
      disarmTimeout()
    }
    await settleUserInputResolution({
      turns: deps.turns,
      events: deps.events,
      sessionStore: deps.sessionStore,
      threadId,
      turnId,
      itemId: item.id,
      inputId: input.id,
      prompt: input.prompt,
      questions: input.questions,
      resolution,
      requestedSeq,
      nowIso: deps.nowIso,
      signal
    })
    return resolution
  }
}
