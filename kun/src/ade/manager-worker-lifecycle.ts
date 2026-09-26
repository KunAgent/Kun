import type { TurnItem, AssistantTextTurnItem } from '../contracts/items.js'
import type { RuntimeEvent } from '../contracts/events.js'
import type {
  DispatchRecord,
  TurnRunOutcome,
  WorkerNotice,
  WorkerRecord
} from '../contracts/ade.js'
import type { ManagerRuntimeDeps } from './manager-runtime.js'

/**
 * ADE worker lifecycle events (09 §5 turnId backfill, §6.1 terminal hook,
 * ephemeral release, startup reconciliation). Extracted from ManagerRuntime;
 * every method here runs detached from the calling turn — event handling is
 * fire-and-forget so the runtime event pipeline is never held by workspace
 * captures or store writes.
 */
export class ManagerWorkerLifecycle {
  constructor(private readonly deps: ManagerRuntimeDeps) {}

  /**
   * Runtime-event observer hook (09 §5 turnId backfill + §6.1 terminal
   * hook). Wired onto the RuntimeEventRecorder's observer list; every
   * branch is fire-and-forget so the event pipeline is never held by
   * workspace captures or store writes.
   */
  handleRuntimeEvent(event: RuntimeEvent): void {
    if (event.child || !event.turnId) return
    const turnId = event.turnId
    switch (event.kind) {
      case 'turn_started':
        void this.backfillDispatchTurnId(event.threadId, turnId).catch((error) => {
          console.warn('[kun] ade dispatch turnId backfill failed:', error)
        })
        return
      case 'turn_completed':
      case 'turn_failed':
      case 'turn_aborted':
        void this.handleWorkerTurnTerminal(
          event.threadId,
          turnId,
          event.kind === 'turn_completed'
            ? 'completed'
            : event.kind === 'turn_aborted'
              ? 'aborted'
              : 'failed'
        ).catch((error) => {
          console.warn('[kun] ade worker terminal handling failed:', error)
        })
        return
    }
  }

  /**
   * `turn_started` on a worker thread: the admitted turn's clientRequestId
   * is the dispatchId — backfill `turnId` on the accepted dispatch (09 §5).
   */
  private async backfillDispatchTurnId(workerThreadId: string, turnId: string): Promise<void> {
    const thread = await this.deps.threads.get(workerThreadId).catch(() => null)
    const unit = thread?.executionUnit
    if (!thread || unit?.kind !== 'worker') return
    const turn = thread.turns.find((entry) => entry.id === turnId)
      ?? await this.deps.turns.getTurn(workerThreadId, turnId).catch(() => null)
    const key = turn?.clientRequestId
    if (!key) return
    const dispatch = await this.deps.dispatches.findByClientRequestId(unit.teamId, key)
    if (!dispatch || dispatch.turnId === turnId) return
    if (dispatch.state === 'completed' || dispatch.state === 'failed' || dispatch.state === 'cancelled') {
      return
    }
    await this.deps.dispatches.update(unit.teamId, dispatch.dispatchId, { turnId }).catch(() => undefined)
  }

  /**
   * Worker turn terminal hook (09 §6.1): resolves the owning dispatch,
   * captures the task-workspace diff, persists outcome + excerpt, enqueues
   * a manager notice, then delivers the worker's next queued dispatch.
   * User-originated worker turns (no dispatch) return silently. Idempotent:
   * the terminal write requires `accepted`, so replays and double hooks
   * (event observer + runAgentTurn call site) are no-ops.
   */
  async handleWorkerTurnTerminal(
    workerThreadId: string,
    turnId: string,
    outcome: TurnRunOutcome
  ): Promise<void> {
    if (outcome !== 'completed' && outcome !== 'failed' && outcome !== 'aborted') return
    const thread = await this.deps.threads.get(workerThreadId).catch(() => null)
    const unit = thread?.executionUnit
    if (!thread || unit?.kind !== 'worker') return
    const team = await this.deps.teams.get(unit.teamId)
    const worker = team?.workers.find((entry) => entry.workerId === workerThreadId)
    if (!team || !worker) return
    let dispatch = await this.deps.dispatches.findByTurn(team.teamId, turnId)
    if (!dispatch) {
      const turn = thread.turns.find((entry) => entry.id === turnId)
        ?? await this.deps.turns.getTurn(workerThreadId, turnId).catch(() => null)
      if (turn?.clientRequestId) {
        dispatch = await this.deps.dispatches.findByClientRequestId(team.teamId, turn.clientRequestId)
      }
    }
    if (!dispatch) return
    if (
      dispatch.state !== 'accepted' &&
      dispatch.state !== 'delivering' &&
      dispatch.state !== 'uncertain'
    ) {
      return
    }
    const capture = worker.taskWorkspaceId && this.deps.taskWorkspaces
      ? await this.deps.taskWorkspaces
          .captureForDispatch(worker.taskWorkspaceId)
          .then((result) => result.stat)
          .catch(() => undefined)
      : undefined
    const resultExcerpt = dispatch.workerReport
      ? undefined
      : await this.lastAssistantExcerpt(workerThreadId, turnId)
    // A turn admitted but terminated before the deliverer marked `accepted`
    // is still completing a dispatch; normalize through 'accepted' first so
    // the terminal transition is legal.
    if (dispatch.state !== 'accepted') {
      dispatch = (await this.deps.dispatches.update(team.teamId, dispatch.dispatchId, {
        state: 'accepted',
        turnId
      }, { expect: ['delivering', 'uncertain'] })) ?? dispatch
    }
    const updated = await this.deps.dispatches.update(
      team.teamId,
      dispatch.dispatchId,
      {
        state: outcome === 'completed' ? 'completed' : outcome === 'aborted' ? 'cancelled' : 'failed',
        outcome,
        turnId: dispatch.turnId ?? turnId,
        ...(capture ? { capture } : {}),
        ...(resultExcerpt ? { resultExcerpt } : {})
      },
      { expect: ['accepted'] }
    )
    if (!updated) return
    await this.deps.notices.enqueue(this.noticeForDispatch(updated, worker)).catch((error) => {
      console.warn(`[kun] ade worker notice enqueue failed for ${updated.dispatchId}:`, error)
    })
    await this.deps.deliverer.tryDeliverNext(team.teamId, worker.workerId).catch((error) => {
      console.warn(`[kun] ade next-dispatch delivery failed for ${worker.workerId}:`, error)
    })
    if (worker.lifecycle === 'ephemeral' && outcome === 'completed') {
      this.scheduleRelease(team.teamId, worker.workerId)
    }
  }

  /**
   * Delayed ephemeral-worker release (09 §6.1): the workspace stays for
   * review; the worker stops accepting dispatches and leaves the live roster.
   */
  private scheduleRelease(teamId: string, workerId: string): void {
    const delay = this.deps.ephemeralReleaseDelayMs?.() ?? 30_000
    const timer = setTimeout(() => {
      void this.releaseEphemeral(teamId, workerId).catch((error) => {
        console.warn(`[kun] ade ephemeral worker release failed for ${workerId}:`, error)
      })
    }, delay)
    timer.unref?.()
  }

  private async releaseEphemeral(teamId: string, workerId: string): Promise<void> {
    const worker = await this.deps.teams.worker(teamId, workerId)
    if (!worker || worker.state !== 'active' || worker.control !== 'manager') return
    this.deps.deliverer.abortWorker(workerId)
    await this.deps.teams.updateWorker(teamId, workerId, {
      state: 'released',
      releasedAt: this.deps.nowIso()
    })
    this.deps.activity?.apply(workerId, { residency: 'dormant' }, 'hook')
    await this.deps.notices.enqueue({
      noticeId: `ntc_release_${workerId}`,
      teamId,
      workerId,
      kind: 'worker_released',
      title: worker.label,
      harnessLabel: this.harnessLabel(worker),
      createdAt: this.deps.nowIso()
    }).catch(() => undefined)
  }

  private noticeForDispatch(dispatch: DispatchRecord, worker: WorkerRecord): WorkerNotice {
    const detail = dispatch.workerReport?.summary ?? dispatch.resultExcerpt
    return {
      noticeId: `ntc_${dispatch.dispatchId}`,
      teamId: dispatch.teamId,
      workerId: dispatch.workerId,
      kind: dispatch.state === 'completed'
        ? 'dispatch_completed'
        : dispatch.state === 'cancelled'
          ? 'dispatch_cancelled'
          : 'dispatch_failed',
      dispatchId: dispatch.dispatchId,
      title: dispatch.title,
      harnessLabel: this.harnessLabel(worker),
      ...(detail ? { detail: detail.slice(0, 4_000) } : {}),
      ...(dispatch.capture
        ? {
            capture: {
              changedFiles: dispatch.capture.changedFiles,
              insertions: dispatch.capture.insertions,
              deletions: dispatch.capture.deletions
            }
          }
        : {}),
      createdAt: this.deps.nowIso()
    }
  }

  private harnessLabel(worker: WorkerRecord): string | undefined {
    const name = this.deps.catalog.get(worker.route.harnessId)?.displayName ?? worker.route.harnessId
    const label = worker.route.model ? `${name} · ${worker.route.model}` : name
    return label.length <= 160 ? label : label.slice(0, 160)
  }

  /** Tail of the worker's last assistant message for this turn (<=1500). */
  private async lastAssistantExcerpt(
    workerThreadId: string,
    turnId: string
  ): Promise<string | undefined> {
    const items = await this.deps.sessionStore.loadItems(workerThreadId).catch((): TurnItem[] => [])
    const texts = items
      .filter((item): item is AssistantTextTurnItem =>
        item.kind === 'assistant_text' && item.turnId === turnId)
      .map((item) => item.text)
      .filter((text) => text.trim().length > 0)
    const last = texts.at(-1)
    return last ? last.slice(-1_500) : undefined
  }

  /**
   * Startup reconciliation (09 §5): re-resolve stuck `delivering`/`uncertain`
   * dispatches against the worker thread's turns, then replay the terminal
   * hook for `accepted` dispatches whose turns ended while the app was off.
   */
  async reconcileOnStartup(): Promise<void> {
    await this.deps.deliverer.reconcileAll()
    for (const team of await this.deps.teams.list()) {
      for (const dispatch of await this.deps.dispatches.listByState(team.teamId, ['accepted'])) {
        const thread = await this.deps.threads.get(dispatch.workerId).catch(() => null)
        const turn = thread?.turns.find((entry) => entry.id === dispatch.turnId)
          ?? thread?.turns.find((entry) => entry.clientRequestId === dispatch.dispatchId)
        if (!turn) continue
        if (turn.status === 'completed' || turn.status === 'failed' || turn.status === 'aborted') {
          await this.handleWorkerTurnTerminal(dispatch.workerId, turn.id, turn.status)
            .catch((error) => {
              console.warn(`[kun] ade terminal replay failed for ${dispatch.dispatchId}:`, error)
            })
        }
      }
    }
  }
}
