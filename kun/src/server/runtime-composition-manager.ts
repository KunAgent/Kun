import {
  HARNESS_CAPABILITY_KEYS,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../contracts/harness-capabilities.js'
import type { ManagerRuntimeDeps } from '../ade/manager-runtime.js'
import { ManagerRuntime } from '../ade/manager-runtime.js'
import { ActivityHibernation } from '../services/activity-hibernation.js'
import { createQuotaSnapshot } from '../ade/quota-snapshot.js'
import { costTierFromPricing } from '../ade/worker-selector.js'
import { effectiveCapabilitiesForRoute } from '../harness/effective-capabilities.js'
import type { HarnessRoute } from '../contracts/harness.js'
import type { HarnessRuntimeMap } from '../harness/harness-router.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import type { createRuntimeServices } from './runtime-composition-services.js'
import type { FileReviewStore } from '../ade/review-store.js'
import { reanchorWorkspaceComments } from '../ade/review-reanchor.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'

type RuntimeServices = Awaited<ReturnType<typeof createRuntimeServices>>

export function noHarnessCapabilities(): HarnessCapabilities {
  return {
    statuses: Object.fromEntries(
      HARNESS_CAPABILITY_KEYS.map((key) => [key, unsupported('not-implemented')])
    ) as HarnessCapabilityStatuses,
    facts: { sandbox: 'none', usageReporting: 'none', compactionOwner: 'none' }
  }
}

export function createCapabilitiesForRoute(
  catalog: Pick<ManagerRuntimeDeps['catalog'], 'get'>,
  harnessRuntimeMap: HarnessRuntimeMap
): (route: HarnessRoute) => Promise<HarnessCapabilities> {
  return (route) => {
    const def = catalog.get(route.harnessId)
    return Promise.resolve(def
      ? effectiveCapabilitiesForRoute(
          def,
          harnessRuntimeMap.get()[def.transport],
          route.providerId
        )
      : noHarnessCapabilities())
  }
}

/**
 * ADE manager control plane wiring (09 §4, 10 §3.2): assembles ManagerRuntime
 * deps from the composition composites. The runtime fills
 * isolated/unattended/recentFailures/managerRoute/language per call.
 */
export function createManagerRuntime(input: {
  services: Pick<RuntimeServices, 'adeStores' | 'harnesses' | 'workerCallbacks'>
  core: Pick<
    RuntimeServices['model']['core'],
    'taskWorkspaces' | 'activityStore' | 'activeOptions' | 'modelCapabilities'
  >
  delegationRuntime: DelegationRuntime | undefined
  harnessRuntimeMap: HarnessRuntimeMap
  listQuota(): ReturnType<RuntimeServices['model']['providerQuotaService']['list']>
} & Omit<
  ManagerRuntimeDeps,
  | 'teams' | 'dispatches' | 'questions' | 'taskWorkspaces' | 'activity' | 'catalog'
  | 'detector' | 'capabilitiesForRoute' | 'delegation' | 'selector'
  | 'allowUnattendedFullAccess' | 'teamLimits' | 'managerMayApprove'
  | 'workerCallbacks' | 'language'
>): ManagerRuntime {
  const {
    services,
    core,
    delegationRuntime,
    harnessRuntimeMap,
    listQuota,
    ...runtimeDeps
  } = input
  return new ManagerRuntime({
    ...runtimeDeps,
    ...services.adeStores,
    taskWorkspaces: core.taskWorkspaces,
    activity: core.activityStore,
    delegation: delegationRuntime,
    catalog: services.harnesses.catalog,
    detector: services.harnesses.detector,
    capabilitiesForRoute: createCapabilitiesForRoute(
      services.harnesses.catalog,
      harnessRuntimeMap
    ),
    language: () => Intl.DateTimeFormat().resolvedOptions().locale,
    allowUnattendedFullAccess: () => core.activeOptions.ade?.allowUnattendedFullAccess === true,
    teamLimits: () => core.activeOptions.ade?.limits,
    workerCallbacks: services.workerCallbacks,
    managerMayApprove: () => core.activeOptions.ade?.managerMayApprove === true,
    selector: {
      profiles: (workspace) =>
        delegationRuntime?.listRoutingProfiles(workspace) ?? Promise.resolve([]),
      quota: createQuotaSnapshot({ list: listQuota }),
      agentOrder: () => core.activeOptions.harnesses?.agentOrder ?? [],
      modelCostTier: (route) =>
        costTierFromPricing(core.modelCapabilities(route.model, route.providerId).pricing)
    }
  })
}

/**
 * Activity stall + dormancy scanner (docs/ade/06 §6, §7.2). A dormant
 * worker keeps its session binding; the next turn resumes natively or
 * falls back to portable through the delegated session coordinator.
 */
export function createActivityHibernation(input: {
  core: Pick<
    RuntimeServices['model']['core'],
    'activityStore' | 'activeOptions' | 'acpConnectionPool'
  >
  managerRuntime: ManagerRuntime
}): ActivityHibernation {
  const { core, managerRuntime } = input
  const hibernation = new ActivityHibernation(
    {
      apply: (unitId, patch) => core.activityStore.apply(unitId, patch, 'inferred'),
      list: () => core.activityStore.list(),
      lastEventAt: (unitId) => core.activityStore.lastEventAt(unitId),
      hasOpenWork: (row) => managerRuntime.hasOpenWork(row.unitId),
      // Structured harnesses always continue portably; terminal agents need
      // resumeArgs, which the terminal runtime supplies when it lands (P2-03).
      canResume: (row) => row.kind === 'worker',
      releaseResident: (row) => core.acpConnectionPool?.releaseForUnit(row.threadId)
    },
    {
      thresholds: () => {
        const ade = core.activeOptions.ade
        return {
          enabled: ade?.hibernation?.enabled !== false,
          dormantMs: (ade?.hibernation?.idleMinutes ?? 30) * 60_000,
          stallStructuredMs: (ade?.stall?.structuredMinutes ?? 10) * 60_000,
          stallTerminalMs: (ade?.stall?.terminalMinutes ?? 20) * 60_000
        }
      }
    }
  )
  hibernation.start()
  return hibernation
}

/**
 * Task-workspace change side-effects: deliver dispatches queued while the
 * workspace was provisioning (09 §5), and re-anchor unresolved review
 * comments after every fresh capture (11 §4.3).
 */
export function wireTaskWorkspaceChange(
  taskWorkspaces: Pick<TaskWorkspaceService, 'onChange'>,
  managerRuntime: ManagerRuntime,
  reviews: FileReviewStore
): void {
  taskWorkspaces.onChange((record) => {
    void managerRuntime.handleWorkspaceChange(record).catch((error) =>
      console.warn('[kun] ade workspace-change delivery failed:', error))
    if (record.state === 'captured' && record.patchArtifactId) {
      void reanchorWorkspaceComments(reviews, record).catch((error) =>
        console.warn('[kun] ade review reanchor failed:', error))
    }
  })
}
