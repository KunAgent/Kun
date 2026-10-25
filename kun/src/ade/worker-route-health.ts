import type { HarnessRoute } from '../contracts/harness.js'
import type { ChildRunFailure } from '../contracts/subagent-retry.js'
import type { FileDelegationStore } from '../delegation/delegation-runtime-contracts.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'

/**
 * Failure accounting for one worker route inside a team. A route is the
 * engine plus provider plus model: a model the account cannot use says
 * nothing about another model on the same engine.
 */
export type WorkerRouteHealth = {
  /** Failed dispatches on this route within the last hour. */
  failures: number
  /** Set when a failure proved the route cannot run here at all. */
  unusable?: string
}

export type WorkerRouteHealthStores = {
  teams: Pick<FileTeamStore, 'get'>
  dispatches: Pick<FileDispatchStore, 'list'>
  /** Child failure facts; without them only the count is known. */
  childRuns?: Pick<FileDelegationStore, 'get'>
}

type RouteIdentity = Pick<HarnessRoute, 'harnessId' | 'providerId' | 'model'>

const WINDOW_MS = 60 * 60_000

export function sameWorkerRoute(a: RouteIdentity, b: RouteIdentity): boolean {
  return a.harnessId === b.harnessId && (a.providerId ?? '') === (b.providerId ?? '') && a.model === b.model
}

export function workerRouteKey(route: RouteIdentity): string {
  return JSON.stringify([route.harnessId, route.providerId ?? '', route.model])
}

/** Model failures no retry on the same route can fix: the model is not offered here, or credentials were refused. */
export function routeUnusableFailure(failure: ChildRunFailure | undefined): boolean {
  return failure?.source === 'model' &&
    (failure.category === 'model_not_found' || failure.category === 'authentication')
}

/**
 * Same-team failures of this route within the last hour. A later completed
 * dispatch on the route clears an earlier unusable verdict (the user fixed
 * the account or the provider started offering the model).
 */
export async function workerRouteHealth(
  stores: WorkerRouteHealthStores,
  teamId: string,
  route: RouteIdentity,
  nowMs = Date.now()
): Promise<WorkerRouteHealth> {
  const team = await stores.teams.get(teamId)
  if (!team) return { failures: 0 }
  const workers = new Set(team.workers
    .filter((worker) => sameWorkerRoute(worker.route, route))
    .map((worker) => worker.workerId))
  if (!workers.size) return { failures: 0 }
  const cutoff = nowMs - WINDOW_MS
  const recent = (await stores.dispatches.list(teamId).catch(() => []))
    .filter((dispatch) => workers.has(dispatch.workerId) && Date.parse(dispatch.updatedAt) >= cutoff)
  const failed = recent.filter((dispatch) => dispatch.state === 'failed')
  const lastSuccess = Math.max(-Infinity, ...recent
    .filter((dispatch) => dispatch.state === 'completed')
    .map((dispatch) => Date.parse(dispatch.updatedAt)))
  for (const dispatch of [...failed].reverse()) {
    if (Date.parse(dispatch.updatedAt) <= lastSuccess) continue
    const run = await stores.childRuns?.get(dispatch.workerId).catch(() => undefined)
    if (routeUnusableFailure(run?.failure)) {
      return { failures: failed.length, unusable: (dispatch.failureReason ?? 'The model refused this route.').slice(0, 300) }
    }
  }
  return { failures: failed.length }
}
