import { listHarnessesForManager, type HarnessListDeps } from '../ade/tools/harness-list.js'
import { resolveWorkerRoute } from '../ade/worker-route.js'
import type { HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import { isModelConnectionProfileUsable, type ModelConnectionProfile, type ModelConnectionSnapshot } from '../contracts/model-connections.js'
import type { WorkbenchExecution, WorkbenchRequest } from '../contracts/workbench-links.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { parseGatewayModelId } from '../harness/gateway-model-id.js'
import { legacyProviderKindFor } from '../harness/harness-provider-kind.js'
import type { HarnessRouter } from '../harness/harness-router.js'
import { legacyHarnessForProvider } from '../harness/resolve-turn-harness.js'
import { isRetiredOpenCodeFreeConnection } from '../services/model-connection-registry-usability.js'

type Model = NonNullable<WorkbenchExecution['model']>
const modelIds = (provider: ModelConnectionProfile) => [...new Set([provider.selectedModel, ...provider.models]
  .filter((model): model is string => Boolean(model)))]
const usable = (provider: ModelConnectionProfile) => isModelConnectionProfileUsable(provider) && !isRetiredOpenCodeFreeConnection(provider)
const httpModel = (provider: ModelConnectionProfile) => ['http', 'gemini-cli-api', 'gemini-code-assist'].includes(provider.kind)

/** Read-only access to the same catalog, model pools and admission router as Code. */
export class WorkbenchHarnessService {
  constructor(private readonly deps: HarnessListDeps & {
    router: HarnessRouter
    probeModels?: (definition: HarnessDefinition) => Promise<string[]>
    snapshot: () => Promise<ModelConnectionSnapshot>
    defaultModel: () => { model: string; providerId?: string; accountId?: string }
  }) {}

  /** The effective route is saved on the card before it can start; never silently switch engines. */
  async resolve(request: WorkbenchRequest): Promise<Model> {
    return this.resolveWithSnapshot(request, await this.deps.snapshot())
  }

  private async resolveWithSnapshot(request: WorkbenchRequest, snapshot: ModelConnectionSnapshot, knownStatus?: HarnessStatus | null): Promise<Model> {
    const selected: Model = request.execution?.model ?? this.deps.defaultModel()
    const provider = snapshot.providers.find((entry) => entry.id === selected.providerId)
    const harnessId = selected.harnessId ?? legacyHarnessForProvider(selected.providerId, {
      byId: Object.fromEntries(snapshot.providers.map((entry) => [entry.id, entry.kind])), defaultKind: 'http'
    })
    const definition = this.deps.catalog.get(harnessId)
    if (!definition) throw new Error(`Unknown Code Agent: ${harnessId}`)
    if (this.deps.catalog.isDisabled(harnessId)) throw new Error(`Code Agent is disabled in settings: ${definition.displayName}`)
    if (harnessId !== 'kun' && !this.deps.router.enabled()) throw new Error('External Code Agent routing is disabled in settings')
    if (definition.transport === 'terminal') throw new Error('Terminal-only Agents cannot execute a Code task')
    const mode = request.execution?.mode ?? (request.mode === 'plan' ? 'plan' : 'direct')
    if (harnessId !== 'kun' && (mode !== 'direct' || request.execution?.orchestration === 'graph')) {
      throw new Error('External Code Agents support direct tasks only. Select Kun for plan, auto, goal or Graph tasks.')
    }
    const credentialMode = selected.credentialMode ?? definition.credentialModes[0]!
    this.assertProvider(definition, credentialMode, selected, provider)
    const resolved = await resolveWorkerRoute({ catalog: this.deps.catalog,
      agent: { harnessId, model: selected.model, providerId: selected.providerId, credentialMode },
      providerPool: async (id) => {
        const candidate = snapshot.providers.find((entry) => entry.id === id)
        if (!candidate || !usable(candidate)) return undefined
        if (credentialMode === 'kun-gateway' && (!httpModel(candidate) || candidate.kind !== 'http' || candidate.authType !== 'api-key')) return undefined
        if (harnessId === 'kun' && !httpModel(candidate)) return undefined
        return { kind: candidate.kind, models: modelIds(candidate) }
      }, probedModels: this.deps.probedModels })
    if ('error' in resolved) throw new Error(resolved.error)
    const route = resolved.route
    if (!route.model) throw new Error('Select an available model for this Code Agent')
    if (knownStatus === null) throw new Error(`${definition.displayName} availability could not be checked. Refresh its connection in Code.`)
    const status = knownStatus ?? await this.deps.detector.status(harnessId).catch(() => {
      throw new Error(`${definition.displayName} availability could not be checked. Refresh its connection in Code.`)
    })
    if (definition.transport !== 'native-loop' && (status.installed !== 'yes' || status.login === 'signed-out' ||
      status.versionSupported === false || status.ready === 'no')) {
      throw new Error(`${definition.displayName} is unavailable (${availabilityReason(status)}). Check its installation and sign-in in Code.`)
    }
    const thread = createThreadRecord({ id: 'workbench-admission', title: request.title,
      workspace: request.workspaceRoot ?? '.', ...route, agentSurface: 'code', mode: mode === 'plan' || mode === 'auto' ? 'plan' : 'agent' })
    const turn = createTurnRecord({ id: 'workbench-admission', threadId: thread.id, prompt: '', ...route,
      agentSurface: 'code', mode: thread.mode, orchestration: request.execution?.orchestration ?? 'direct' })
    const admission = this.deps.router.resolve(thread, turn)
    if (!admission.ok) throw new Error(admission.error.userMessage)
    const routedProvider = snapshot.providers.find((entry) => entry.id === route.providerId)
    return { ...route, ...(routedProvider ? { accountId: routedProvider.accountId } : {}),
      ...(selected.reasoningEffort ? { reasoningEffort: selected.reasoningEffort } : {}),
      ...(selected.serviceTier ? { serviceTier: selected.serviceTier } : {}) }
  }

  private assertProvider(definition: HarnessDefinition, mode: string, selected: Model,
    provider: ModelConnectionProfile | undefined): void {
    const address = parseGatewayModelId(selected.model)
    if (mode === 'kun-gateway' && address && selected.providerId && address.providerId !== selected.providerId) {
      throw new Error('The gateway model and selected provider do not match')
    }
    if (selected.providerId && (!provider || !usable(provider))) throw new Error('The selected model connection is unavailable')
    if (selected.accountId && (!provider || provider.accountId !== selected.accountId)) throw new Error('The selected model account is unavailable')
    if (mode === 'native-login' && provider && provider.kind !== legacyProviderKindFor(definition.id)) {
      throw new Error('Native sign-in cannot use an unrelated provider or account')
    }
    if (mode === 'provider' && !selected.providerId) throw new Error('Select a model connection for provider authentication')
  }

  /** Bounded discovery output; launch commands, secret refs and credentials never leave the host. */
  async list(signal?: AbortSignal) {
    const bounded = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])])
    return await abortable(this.listWithin(bounded), bounded)
  }

  private async listWithin(signal: AbortSignal) {
    signal.throwIfAborted()
    const snapshot = await this.deps.snapshot()
    const providers = snapshot.providers.filter(usable)
    const statuses = new Map<string, Promise<HarnessStatus>>()
    const status = (id: string) => {
      signal.throwIfAborted()
      if (this.deps.catalog.isDisabled(id) || (id !== 'kun' && !this.deps.router.enabled())) return Promise.resolve({
        harnessId: id, installed: 'unknown' as const, login: 'unknown' as const, checkedAt: '1970-01-01T00:00:00.000Z'
      })
      if (!statuses.has(id)) statuses.set(id, abortable(this.deps.detector.status(id), signal))
      return statuses.get(id)!
    }
    // Cold-start discovery must not require opening the Code model picker first.
    // Reuse its cached, prompt-free probes and never start disabled/unready engines.
    for (const definition of this.deps.catalog.list().slice(0, 30)) {
      signal.throwIfAborted()
      if (!this.deps.router.enabled() || definition.modelSource !== 'probe' || this.deps.catalog.isDisabled(definition.id) ||
        !definition.credentialModes.includes('native-login') || this.deps.probedModels?.(definition)?.length) continue
      const detected = await status(definition.id).catch(() => undefined)
      if (detected?.installed === 'yes' && detected.login !== 'signed-out' &&
        detected.ready !== 'no' && detected.versionSupported !== false) {
        if (this.deps.probeModels) await abortable(this.deps.probeModels(definition), signal).catch(() => undefined)
      }
    }
    signal.throwIfAborted()
    const listed = await listHarnessesForManager({ ...this.deps, detector: { status }, providers: async () => providers.map((entry) => ({
      providerId: entry.id, label: entry.name, kind: entry.kind, models: modelIds(entry)
    })) })
    const agents = await Promise.all(listed.agents.slice(0, 30).map(async (agent) => {
      signal.throwIfAborted()
      const definition = this.deps.catalog.get(agent.harnessId)!
      const detected = await status(agent.harnessId).catch(() => undefined)
      const models = [...agent.models]
      if (definition.modelSource === 'provider' && definition.credentialModes.includes('native-login')) {
        for (const provider of providers.filter((entry) => entry.kind === legacyProviderKindFor(definition.id))) {
          models.push(...modelIds(provider).slice(0, 8).map((model) => ({ model, providerId: provider.id, credentialMode: 'native-login' as const })))
        }
      }
      let reason = this.deps.catalog.isDisabled(agent.harnessId) ? 'Disabled in Code settings' :
        agent.harnessId !== 'kun' && !this.deps.router.enabled() ? 'External Code Agent routing is disabled in settings' :
        agent.terminalOnly ? 'Terminal-only Agent' : !agent.ready ? availabilityReason(detected) : undefined
      const routes: Model[] = []
      for (const model of models.slice(0, 24)) {
        try {
          routes.push(await this.resolveWithSnapshot({ title: 'Code task', goal: '', mode: 'agent', isolation: 'inherit', report: 'final',
            execution: { mode: 'direct', model: { ...model, harnessId: agent.harnessId } } }, snapshot, detected ?? null))
        } catch (error) { reason ??= error instanceof Error ? error.message : String(error) }
      }
      return { harnessId: agent.harnessId, displayName: agent.displayName, available: routes.length > 0,
        ...(routes.length ? {} : { reason: reason ?? 'No available models. Configure or refresh this Agent in Code.' }),
        models: routes, ...(models.length > 24 || agent.modelsTruncated ? { modelsTruncated: (models.length - Math.min(models.length, 24)) + (agent.modelsTruncated ?? 0) } : {}),
        executionModes: agent.harnessId === 'kun' ? ['direct', 'plan', 'auto', 'goal'] : ['direct'],
        orchestration: agent.harnessId === 'kun' ? ['direct', 'graph'] : ['direct'] }
    }))
    return { agents, ...(listed.agents.length > agents.length ? { agentsTruncated: listed.agents.length - agents.length } : {}) }
  }
}

/** Detection diagnostics may contain command paths; keep discovery/action errors categorical. */
function availabilityReason(status?: HarnessStatus): string {
  if (status?.installed === 'no') return 'not installed'
  if (status?.login === 'signed-out') return 'signed out'
  if (status?.versionSupported === false) return 'unsupported version'
  return 'not ready'
}

/** Stop waiting and stop starting new probes; shared Code probes retain their own bounded lifetime/cache. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Code Agent discovery was cancelled'))
    if (signal.aborted) { operation.catch(() => undefined); abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
