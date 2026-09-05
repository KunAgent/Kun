import type { ThreadRuntimeStateBatchResult } from '../agent/provider-types'
import type { NormalizedThread } from '../agent/types'
import { threadLooksRunning } from '../store/chat-store-runtime-helpers'
import type { AutoPlanBuildIntentV1 } from './auto-plan-build-intents'

export const AUTO_PLAN_BUILD_RECOVERY_RETRY_MS = 1_000

type RecoveryCoordinatorDependencies = {
  listIntents: () => AutoPlanBuildIntentV1[]
  intentIsEligible: (intent: AutoPlanBuildIntentV1) => boolean
  loadThreadStates: (threadIds: string[]) => Promise<ThreadRuntimeStateBatchResult[]>
  inspectIntent: (intent: AutoPlanBuildIntentV1) => Promise<void>
  errorIsRetryable: (error: unknown) => boolean
  onError?: (error: unknown) => void
  retryDelayMs?: number
}

export type AutoPlanBuildRecoveryDiagnostics = {
  active: boolean
  retryPending: boolean
  sweepsStarted: number
  wakeupsCoalesced: number
  retriesScheduled: number
}

function intentThreadIds(intents: readonly AutoPlanBuildIntentV1[]): string[] {
  return [...new Set(intents.map((intent) => intent.threadId.trim()).filter(Boolean))]
}

function stateAllowsTimelineRead(
  result: Extract<ThreadRuntimeStateBatchResult, { ok: true }>
): boolean {
  return !threadLooksRunning(result.state) &&
    (result.state.pendingUserInputIds?.length ?? 0) === 0
}

/**
 * Serializes renderer-owned Automatic recovery. A wakeup during the first
 * sweep requests one fresh trailing sweep; wakeups during that trailing pass
 * are delayed through the retry timer so continuous UI activity cannot keep a
 * foreground-competing loop alive indefinitely.
 */
export class AutoPlanBuildRecoveryCoordinator {
  private active: Promise<void> | null = null
  private wakeupPending = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private sweepsStarted = 0
  private wakeupsCoalesced = 0
  private retriesScheduled = 0

  constructor(private readonly dependencies: RecoveryCoordinatorDependencies) {}

  request(): Promise<void> {
    this.wakeupPending = true
    this.clearRetryTimer()
    if (this.active) {
      this.wakeupsCoalesced += 1
      return this.active
    }

    const generation = this.generation
    let task!: Promise<void>
    task = this.run(generation).finally(() => {
      if (this.active !== task) return
      this.active = null
      if (this.wakeupPending && generation === this.generation) {
        this.scheduleRetry(generation)
      }
    })
    this.active = task
    return task
  }

  diagnostics(): AutoPlanBuildRecoveryDiagnostics {
    return {
      active: this.active !== null,
      retryPending: this.retryTimer !== null,
      sweepsStarted: this.sweepsStarted,
      wakeupsCoalesced: this.wakeupsCoalesced,
      retriesScheduled: this.retriesScheduled
    }
  }

  reset(): void {
    this.generation += 1
    this.wakeupPending = false
    this.clearRetryTimer()
    this.sweepsStarted = 0
    this.wakeupsCoalesced = 0
    this.retriesScheduled = 0
  }

  private async run(generation: number): Promise<void> {
    this.wakeupPending = false
    let retryNeeded = await this.runSweep(generation)
    if (generation !== this.generation) return

    if (this.wakeupPending) {
      this.wakeupPending = false
      retryNeeded = (await this.runSweep(generation)) || retryNeeded
    }
    if (generation !== this.generation) return

    if (this.wakeupPending) {
      this.wakeupPending = false
      retryNeeded = true
    }
    if (retryNeeded) this.scheduleRetry(generation)
  }

  private async runSweep(generation: number): Promise<boolean> {
    this.sweepsStarted += 1
    const intents = this.dependencies.listIntents().filter((intent) =>
      intent.threadId.trim() && this.dependencies.intentIsEligible(intent)
    )
    if (intents.length === 0) return false

    let results: ThreadRuntimeStateBatchResult[]
    try {
      results = await this.dependencies.loadThreadStates(intentThreadIds(intents))
    } catch (error) {
      this.dependencies.onError?.(error)
      return this.dependencies.errorIsRetryable(error)
    }
    if (generation !== this.generation) return false

    const states = new Map(results.map((result) => [result.id, result]))
    let retryNeeded = false
    for (const intent of intents) {
      if (generation !== this.generation) return false
      const result = states.get(intent.threadId)
      if (!result || !result.ok) {
        if (!result || result.error.code === 'unavailable') retryNeeded = true
        continue
      }
      if (!stateAllowsTimelineRead(result)) continue
      try {
        // Deliberately sequential: Automatic recovery owns one background
        // timeline request globally, even when many old intents are terminal.
        await this.dependencies.inspectIntent(intent)
      } catch (error) {
        this.dependencies.onError?.(error)
        if (this.dependencies.errorIsRetryable(error)) retryNeeded = true
      }
    }
    return retryNeeded
  }

  private scheduleRetry(generation: number): void {
    if (this.retryTimer || generation !== this.generation) return
    this.retriesScheduled += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (generation === this.generation) void this.request()
    }, this.dependencies.retryDelayMs ?? AUTO_PLAN_BUILD_RECOVERY_RETRY_MS)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }
}

export function autoPlanBuildRecoveryThreadSignature(
  threads: readonly Pick<
    NormalizedThread,
    'id' | 'status' | 'latestTurnId' | 'latestTurnStatus'
  >[]
): string {
  return threads.map((thread) => [
    thread.id,
    thread.status ?? '',
    thread.latestTurnId ?? '',
    thread.latestTurnStatus ?? ''
  ].join(':')).join('|')
}
