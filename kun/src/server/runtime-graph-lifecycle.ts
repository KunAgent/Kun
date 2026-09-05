import {
  GraphRuntimeComposition,
  TurnService
} from './runtime-factory-dependencies.js'

export async function shutdownGraphExecutionForHost(input: {
  graphRuntime: Pick<GraphRuntimeComposition, 'quiesceExecution' | 'stop'>
  turnService: Pick<TurnService, 'suspendActiveTurnsForShutdown'>
}): Promise<void> {
  // Scheduler shutdown owns the special non-consuming worker interruption
  // marker. Park source turns only after every active attempt has recorded it.
  await input.graphRuntime.quiesceExecution()
  await input.turnService.suspendActiveTurnsForShutdown()
  await input.graphRuntime.stop()
}

/**
 * Preserve the shutdown ownership boundary even when one execution phase
 * fails: active runs get their bounded unwind window and Manager leases are
 * drained before persistent services are allowed to close.
 */
export async function shutdownRuntimeExecutionForHost(input: {
  prepare: () => Promise<void> | void
  graphRuntime: Pick<GraphRuntimeComposition, 'quiesceExecution' | 'stop'>
  turnService: Pick<TurnService, 'suspendActiveTurnsForShutdown'>
  activeRuntimeRuns: ReadonlySet<Promise<unknown>>
  shutdownLeases: () => Promise<void>
}): Promise<void> {
  const errors: unknown[] = []
  const run = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step()
    } catch (error) {
      errors.push(error)
    }
  }
  await run(async () => { await input.prepare() })
  await run(() => input.graphRuntime.quiesceExecution())
  await run(async () => { await input.turnService.suspendActiveTurnsForShutdown() })
  await run(() => input.graphRuntime.stop())
  await run(() => waitForActiveRuns(input.activeRuntimeRuns))
  await run(input.shutdownLeases)
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'multiple runtime execution shutdown phases failed')
  }
}

export async function resumeInterruptedGraphPlanning(input: {
  graphRuntime: Pick<GraphRuntimeComposition, 'drafts'>
  turnService: Pick<
    TurnService,
    'getTurn' | 'resumeGraphPlanningTurn'
  >
  runTurn: (threadId: string, turnId: string) => Promise<unknown> | void
}): Promise<number> {
  const drafts = await input.graphRuntime.drafts.list({
    statuses: ['planning', 'validating', 'repairing']
  })
  let resumed = 0
  for (const draft of drafts) {
    const source = await input.turnService.getTurn(draft.threadId, draft.sourceTurnId)
    if (
      source?.status !== 'running' ||
      source.orchestration !== 'graph'
    ) continue
    try {
      const outcome = await input.turnService.resumeGraphPlanningTurn({
        threadId: draft.threadId,
        turnId: draft.sourceTurnId
      })
      if (outcome !== 'resumed') continue
      resumed += 1
      void Promise.resolve(input.runTurn(draft.threadId, draft.sourceTurnId))
        .catch((error) => {
          console.warn(
            `[kun] restarted Graph planning turn ${draft.sourceTurnId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        })
    } catch (error) {
      console.warn(
        `[kun] could not resume Graph planning draft ${draft.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
  return resumed
}

export async function waitForActiveRuns(
  runs: ReadonlySet<Promise<unknown>>,
  timeoutMs = 5_000
): Promise<void> {
  const pending = [...runs]
  if (pending.length === 0) return
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const results = await Promise.race([
      Promise.allSettled(pending),
      new Promise<null>((resolve) => { timeout = setTimeout(() => resolve(null), timeoutMs) })
    ])
    if (results) {
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : []
      )
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) throw new AggregateError(errors, 'multiple runtime runs failed during shutdown')
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
