import {
  HARNESS_CAPABILITY_KEYS,
  unsupported,
  type HarnessCapabilities,
  type HarnessCapabilityStatuses
} from '../contracts/harness-capabilities.js'
import type { ManagerRuntimeDeps } from '../ade/manager-runtime.js'
import { createManagerToolProvider } from '../adapters/tool/manager-tool-provider.js'
import { TeamBudgetGate } from '../ade/team-budget.js'
import { ManagerRuntime } from '../ade/manager-runtime.js'
import { ActivityHibernation } from '../services/activity-hibernation.js'
import { createQuotaSnapshot } from '../ade/quota-snapshot.js'
import { costTierFromPricing } from '../ade/worker-selector.js'
import { createApprovedChecksResolver } from '../workspace-tasks/approved-setup.js'
import { effectiveCapabilitiesForRoute } from '../harness/effective-capabilities.js'
import { harnessDefaultsFor } from '../harness/harness-defaults.js'
import type { HarnessRoute } from '../contracts/harness.js'
import type { HarnessRuntimeMap } from '../harness/harness-router.js'
import type { DelegationRuntime } from '../delegation/delegation-runtime.js'
import type { createRuntimeServices } from './runtime-composition-services.js'
import type { FileReviewStore } from '../ade/review-store.js'
import { reanchorWorkspaceComments } from '../ade/review-reanchor.js'
import { createAttributionObserver } from '../ade/attribution-observer.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type {
  HarnessListDeps,
  HarnessProviderModelGroup
} from '../ade/tools/harness-list.js'
import type { ModelConnectionSnapshot } from '../contracts/model-connections.js'
import { providerModelIds } from './routes/model-gateway-core.js'
import { exposableProvider } from '../domain/model-gateway-export-policy.js'

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
 * Provider-pool access shared by worker-route validation and `harness_list`
 * (P3-06): reads the modelConnections snapshot, tolerating snapshot failures
 * as "no providers" so the manager tools degrade to static lists.
 */
export function createProviderPoolAccess(
  modelConnections: Pick<RuntimeServices['model'], 'modelConnections'>['modelConnections']
): {
  providers: () => Promise<HarnessProviderModelGroup[]>
  poolEntry: NonNullable<ManagerRuntimeDeps['providerPool']>
} {
  const snapshot = (): Promise<ModelConnectionSnapshot | undefined> =>
    modelConnections.snapshot().catch(() => undefined)
  const providers = async () =>
    ((await snapshot())?.providers ?? []).map((provider) => ({
      providerId: provider.id,
      label: provider.name,
      kind: provider.kind,
      gatewayExportable: exposableProvider(provider),
      models: providerModelIds(provider)
    }))
  const poolEntry = async (providerId: string) => {
    const provider = (await snapshot())?.providers
      .find((candidate) => candidate.id === providerId)
    return provider ? { kind: provider.kind, models: providerModelIds(provider), gatewayExportable: exposableProvider(provider) } : undefined
  }
  return { providers, poolEntry }
}

/**
 * `harness_list` deps (10 §2): catalog + detector + runtime map plus the
 * cached probe read and provider pool for per-credential-mode model lists.
 */
export function createHarnessListDeps(input: {
  services: Pick<RuntimeServices, 'harnesses'>
  harnessRuntimeMap: HarnessRuntimeMap
  listProfiles: () => Array<{
    name: string
    model?: string
    providerId?: string
    description?: string
  }>
  providers?: () => Promise<HarnessProviderModelGroup[]>
}): HarnessListDeps {
  return {
    catalog: input.services.harnesses.catalog,
    readiness: input.services.harnesses.readiness,
    detector: input.services.harnesses.detector,
    runtimes: input.harnessRuntimeMap,
    probedModels: (definition) => input.services.harnesses.probedModels(definition),
    ...(input.providers ? { providers: input.providers } : {}),
    profiles: input.listProfiles
  }
}

/**
 * ADE manager control plane wiring (09 §4, 10 §3.2): assembles ManagerRuntime
 * deps from the composition composites. The runtime fills
 * isolated/unattended/recentFailures/managerRoute/language per call.
 */
export function createManagerRuntime(input: {
  services: Pick<RuntimeServices, 'adeStores' | 'harnesses' | 'workerCallbacks' | 'attribution'>
  core: Pick<
    RuntimeServices['model']['core'],
    | 'taskWorkspaces'
    | 'activityStore'
    | 'activeOptions'
    | 'modelCapabilities'
    | 'artifactStore'
    | 'events'
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
  // AI line attribution (11 §6.1): file-change items feed the ledger.
  wireAttributionObserver(core, services, runtimeDeps.threads, runtimeDeps.nowIso)
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
    canStartNewWork: () => core.activeOptions.ade?.enabled === true,
    allowUnattendedFullAccess: () => core.activeOptions.ade?.allowUnattendedFullAccess === true,
    teamLimits: () => core.activeOptions.ade?.limits,
    teamBudgetPolicy: () => core.activeOptions.ade?.budget,
    teamBudget: runtimeDeps.teamBudget
      ?? (runtimeDeps.usage ? new TeamBudgetGate(runtimeDeps.usage) : undefined),
    workerCallbacks: services.workerCallbacks,
    managerMayApprove: () => core.activeOptions.ade?.managerMayApprove === true,
    // Approved worktree.checks runner (10 §4.2) — digest-bound like setup.
    checks: {
      approvedChecks: createApprovedChecksResolver({
        approvedEntries: () => core.activeOptions.ade?.approvedWorktreeConfigs ?? []
      }),
      artifacts: core.artifactStore
    },
    harnessDefaults: (harnessId) =>
      harnessDefaultsFor(core.activeOptions.harnesses, harnessId),
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
  catalog: Pick<ManagerRuntimeDeps['catalog'], 'get'>
}): ActivityHibernation {
  const { core, managerRuntime, catalog } = input
  const hibernation = new ActivityHibernation(
    {
      apply: (unitId, patch) => core.activityStore.apply(unitId, patch, 'inferred'),
      list: () => core.activityStore.list(),
      lastEventAt: (unitId) => core.activityStore.lastEventAt(unitId),
      hasOpenWork: (row) => managerRuntime.hasOpenWork(row.unitId),
      // Structured harnesses always continue portably; terminal agents
      // resume only when the harness declares `terminal.resumeArgs` (05 §7.3).
      canResume: (row) =>
        row.kind === 'worker' ||
        (row.kind === 'terminal-agent' &&
          (catalog.get(row.harnessId)?.terminal?.resumeArgs?.length ?? 0) > 0),
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

/**
 * AI line attribution (11 §6.1): file-change tool items from every runtime
 * feed the per-workspace ledger through the recorder's observer tap.
 */
export function wireAttributionObserver(
  core: Pick<RuntimeServices['model']['core'], 'events' | 'taskWorkspaces'>,
  services: Pick<RuntimeServices, 'attribution' | 'adeStores'>,
  threads: Parameters<typeof createAttributionObserver>[0]['threads'],
  nowIso: () => string
): void {
  core.events.addObserver(createAttributionObserver({
    ledger: services.attribution,
    taskWorkspaces: core.taskWorkspaces,
    threads,
    teams: services.adeStores.teams,
    dispatches: services.adeStores.dispatches,
    nowIso
  }))
}

/** ADE manager tool surface + workspace review wiring (09 §4, 10 §6). */
export function registerAdeManagerTooling(input: {
  registry: { registerProvider(provider: unknown): void }
  managerRuntime: ManagerRuntime
  services: RuntimeServices
  harnessRuntimeMap: HarnessRuntimeMap
  delegationRuntime?: DelegationRuntime
  providerPool: {
    providers: HarnessListDeps['providers']
  }
  core: RuntimeServices['model']['core']
}): ReturnType<typeof createManagerToolProvider> {
  const provider = createManagerToolProvider({
      manager: input.managerRuntime,
      harnessList: createHarnessListDeps({
        services: input.services,
        harnessRuntimeMap: input.harnessRuntimeMap,
        listProfiles: () => input.delegationRuntime?.listProfiles() ?? [],
        providers: input.providerPool.providers
      }),
      managerMayApprove: () =>
        input.core.activeOptions.ade?.managerMayApprove === true,
      canStartNewWork: () => input.core.activeOptions.ade?.enabled === true,
      race: input.managerRuntime.raceServiceDeps,
      checks: input.managerRuntime.checkRunnerDeps
    })
  input.registry.registerProvider(provider)
  wireTaskWorkspaceChange(
    input.core.taskWorkspaces,
    input.managerRuntime,
    input.services.adeStores.reviews
  )
  return provider
}
