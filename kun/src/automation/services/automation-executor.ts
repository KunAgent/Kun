import type { ThreadService } from '../../services/thread-service.js'
import type { TurnService } from '../../services/turn-service.js'
import type { SessionStore } from '../../ports/session-store.js'

/**
 * Automation Executor
 *
 * In-process bridge from the automation runtime to Kun's thread/turn services.
 * The report (ISSUE-006) flags HTTP self-calls through an unknown baseUrl as
 * broken and insecure; instead we drive the same services the HTTP routes use,
 * with a real run-turn adapter, abort support, and completion polling against
 * the session store.
 */

export type AutomationExecutorDeps = {
  threadService: Pick<ThreadService, 'create' | 'get'>
  turnService: Pick<TurnService, 'startTurn' | 'getTurn'>
  sessionStore: Pick<SessionStore, 'loadItems'>
  /** Real run-turn adapter (runtime.runTurn). Returns terminal status when awaited. */
  runTurn: (threadId: string, turnId: string) => Promise<'completed' | 'failed' | 'aborted'> | void
  defaultModel: string
  workspace: string
  now?: () => number
}

export type ExecuteRequest = {
  systemPrompt: string
  expertId?: string
  inputText: string
  title: string
  /** Abort signal to cancel a running task. */
  signal?: AbortSignal
  /** Max time to wait for the turn to complete, in ms. Default 180s. */
  timeoutMs?: number
}

export type ExecuteResult = {
  text: string
  threadId: string
  turnId: string
  tokensUsed: number
  toolCallCount: number
}

const DEFAULT_TIMEOUT_MS = 180_000
const POLL_INTERVAL_MS = 500

export class AutomationExecutor {
  constructor(private readonly deps: AutomationExecutorDeps) {}

  async execute(request: ExecuteRequest): Promise<ExecuteResult> {
    const thread = await this.deps.threadService.create({
      title: request.title,
      workspace: this.deps.workspace,
      model: this.deps.defaultModel,
      mode: 'agent',
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      ...(request.expertId ? { expertId: request.expertId } : {})
    })

    const started = await this.deps.turnService.startTurn({
      threadId: thread.id,
      request: {
        prompt: request.inputText,
        // Automation tasks are headless: no interactive user is attached.
        disableUserInput: true,
        attachmentIds: [],
        fileReferences: []
      }
    })
    const turnId = started.turnId

    // Drive the turn. runTurn may return void (fire-and-forget) or a promise
    // resolving to a terminal status; await either way.
    const runPromise = Promise.resolve(this.deps.runTurn(thread.id, turnId))

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const deadline = this.nowMs() + timeoutMs

    // Wait for the turn to reach a terminal status (or abort/timeout).
    // We await runPromise where possible but still poll the persisted turn so
    // the result reflects committed state even for a void runTurn.
    await this.raceRunOrPoll(runPromise, thread.id, turnId, deadline, request.signal)

    const turn = await this.deps.turnService.getTurn(thread.id, turnId)
    if (!turn) throw new Error(`automation turn vanished: ${thread.id}/${turnId}`)
    if (turn.status === 'aborted') throw new Error('automation task aborted')
    if (turn.status === 'failed') throw new Error(turn.error || 'automation task failed')
    if (turn.status !== 'completed') throw new Error('automation task did not complete in time')

    const items = await this.deps.sessionStore.loadItems(thread.id)
    const assistantText = items
      .filter((item) => item.turnId === turnId && item.kind === 'assistant_text')
      .map((item) => ('text' in item ? String((item as { text?: string }).text ?? '') : ''))
      .join('')

    const toolCallCount = items.filter(
      (item) => item.turnId === turnId && item.kind === 'tool_call'
    ).length

    return {
      text: assistantText,
      threadId: thread.id,
      turnId,
      tokensUsed: 0,
      toolCallCount
    }
  }

  private async raceRunOrPoll(
    runPromise: Promise<unknown>,
    threadId: string,
    turnId: string,
    deadline: number,
    signal?: AbortSignal
  ): Promise<void> {
    let runSettled = false
    const runTracked = runPromise.then(
      () => { runSettled = true },
      () => { runSettled = true }
    )

    while (this.nowMs() < deadline) {
      if (signal?.aborted) return
      const turn = await this.deps.turnService.getTurn(threadId, turnId)
      if (turn && (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted')) {
        return
      }
      if (runSettled) {
        // runTurn finished; give the store one more read then return.
        const settledTurn = await this.deps.turnService.getTurn(threadId, turnId)
        if (settledTurn && settledTurn.status !== 'queued' && settledTurn.status !== 'running') {
          return
        }
      }
      await this.sleep(POLL_INTERVAL_MS)
    }
    void runTracked
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
