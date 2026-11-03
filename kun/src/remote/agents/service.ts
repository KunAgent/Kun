import { RemoteAgentAvatar } from './avatar.js'
import { RemoteAgentCatalog } from './catalog.js'
import { RemoteAgentLifecycle } from './lifecycle.js'
import { RemoteAgentImport } from './import.js'
import { AgentLifecycleParams } from './lifecycle-contracts.js'
import { AgentImportParams } from './import-contracts.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { RoomStoreConflictError } from '../../rooms/room-store.js'
import { currentAgentConversation } from '../../agents/agent-conversations.js'
import { directActivity } from '../../agents/agent-direct-service.js'
import { AgentParamSchemas, AGENT_READ_METHODS } from './contracts.js'
import { RemoteAgentMemory } from './memory/service.js'
import { RemoteMemoryCandidates } from './memory/candidates.js'
import { RemoteMemoryHistory } from './memory/history.js'
import { RemoteAgentRuns } from './library/runs.js'
import { RemoteAgentArtifacts } from './library/artifacts.js'
import { RemoteAgentReminders } from './reminders.js'
import { RemoteAgentCommitments } from './commitments.js'
import { publicAgent, requireAgent } from './access.js'
import { codeAgents } from '../code/model-catalog.js'
import { receiptKey } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'
import type { LocalCall } from '../runtime/local-call.js'
import type { Envelope } from '../contracts.js'
import { recoverAgentOperation } from './recovery.js'
import type { Receipt } from '../requests/receipts.js'
import type { RemoteScope } from '../contracts.js'
import type { CapabilityDescriptor } from '@kun/remote-protocol'
export { AgentParamSchemas, AGENT_READ_METHODS }
/** Personal Agent operations share the same runtime services and Manager persistence as HTTP. */
export class RemoteAgents {
  private readonly avatar: RemoteAgentAvatar
  private readonly catalog: RemoteAgentCatalog
  private readonly lifecycle: RemoteAgentLifecycle
  private readonly importer: RemoteAgentImport
  private readonly memory: RemoteAgentMemory
  private readonly commitments: RemoteAgentCommitments
  private readonly candidates: RemoteMemoryCandidates
  private readonly history: RemoteMemoryHistory
  private readonly runs: RemoteAgentRuns
  private readonly artifacts: RemoteAgentArtifacts
  private readonly reminders: RemoteAgentReminders
  constructor(private readonly runtime: ServerRuntime, private readonly call: LocalCall) {
    this.avatar = new RemoteAgentAvatar(runtime)
    this.catalog = new RemoteAgentCatalog(runtime)
    this.lifecycle = new RemoteAgentLifecycle(runtime)
    this.importer = new RemoteAgentImport(runtime)
    this.memory = new RemoteAgentMemory(runtime.rooms!)
    this.commitments = new RemoteAgentCommitments(runtime.rooms!)
    this.candidates = new RemoteMemoryCandidates(runtime.rooms!)
    this.history = new RemoteMemoryHistory(runtime.rooms!)
    this.runs = new RemoteAgentRuns(runtime)
    this.artifacts = new RemoteAgentArtifacts(runtime)
    this.reminders = new RemoteAgentReminders(runtime)
  }
  supports(method: string): method is keyof typeof AgentParamSchemas { return Object.hasOwn(AgentParamSchemas, method) }
  recover(scope: RemoteScope, receipt: Receipt) {
    if (receipt.method === 'agent.avatar.update') return this.avatar.recover(scope, receipt)
    if (Object.hasOwn(AgentImportParams, receipt.method)) return this.importer.recover(scope, receipt)
    if (Object.hasOwn(AgentLifecycleParams, receipt.method)) return this.lifecycle.recover(scope, receipt)
    return receipt.method === 'agent.reminders.act' ? this.reminders.recover(scope, receipt) : recoverAgentOperation(this.runtime.rooms!, scope, receipt)
  }
  async descriptors(): Promise<CapabilityDescriptor[]> {
    const rooms = this.runtime.rooms!, features = await rooms.agents.features()
    const memory = await rooms.agentMemory.available()
    return Object.keys(AgentParamSchemas).map<CapabilityDescriptor>((operation) => {
      const expanded = ['agent.memory.candidates.', 'agent.memory.history.', 'agent.runs.', 'agent.artifacts.', 'agent.reminders.'].some((prefix) => operation.startsWith(prefix))
      const limits: Record<string, number> = expanded ? { pageSize: 20, contentChars: 16000 } : { pageSize: 50 }
      const catalogAvailable = operation === 'agent.skills.list' ? Boolean(this.runtime.skills)
        : operation === 'agent.connections.list' ? Boolean(this.runtime.mcpConfig && this.runtime.toolDiagnostics && this.runtime.mcpOAuth) : true
      if (operation.startsWith('agent.avatar.')) limits.imageInputBytes = 2097152
      if (operation === 'agent.skills.list' || operation === 'agent.connections.list') limits.pageSize = 20
      return { operation, schemaVersion: 1, resourceKind: 'agent',
      allowedActions: [AGENT_READ_METHODS.has(operation) ? 'read' : 'write'], supported: catalogAvailable,
      enabled: operation === 'agent.create' || operation.startsWith('agent.import.') ? features.identities : ['agent.memory.update', 'agent.memory.candidates.decide'].includes(operation) ? memory
        : operation.startsWith('agent.memory.') ? Boolean(rooms.deps.memoryStore)
        : operation.startsWith('agent.artifacts.') ? rooms.artifactLibrary.available : catalogAvailable,
      authorized: true, online: true, limits }
    })
  }
  private async choices() {
    const catalog = await codeAgents(this.runtime, this.runtime.defaultModel ? [this.runtime.defaultModel] : [])
    return (catalog.find((agent) => agent.id === 'kun')?.routes ?? []).flatMap((route) =>
      route.providerId && route.providerId.length <= 128 ? route.models.filter((model) => model.trim() && model.length <= 256).map((model) => ({
        providerId: route.providerId!, model, label: route.label })) : [])
  }
  async get(agentId: string) {
    await requireAgent(this.runtime.rooms!, agentId)
    const { agent } = await this.call('/v1/agents/' + encodeURIComponent(agentId))
    return { agent: publicAgent(agent), modelChoices: agent.executor ? [] : await this.choices() }
  }
  private async busy(agentId: string) {
    const rooms = this.runtime.rooms!
    const runs = await rooms.deps.store.list('room_run', { participantAgentId: agentId,
      status: ['queued', 'running', 'recovery_required'], limit: 1, summaryOnly: true })
    const room = await currentAgentConversation(rooms.agents, agentId)
    if (runs.length || room && (await directActivity(rooms, room.id)).active) throw new RemoteNoEffect('TASK_BUSY')
  }
  async preflight(method: string, p: any) {
    if (method === 'agent.avatar.update') return this.avatar.preflight(p)
    if (Object.hasOwn(AgentImportParams, method)) return
    if (Object.hasOwn(AgentLifecycleParams, method)) return this.lifecycle.preflight(method, p)
    const rooms = this.runtime.rooms!
    if (method === 'agent.memory.update') return this.memory.preflight(p)
    if (method === 'agent.memory.candidates.decide') return this.candidates.preflight(p)
    if (method === 'agent.reminders.act') return this.reminders.preflight(p)
    if (method === 'agent.commitments.act') return this.commitments.preflight(p)
    if (method === 'agent.create') {
      if (!(await rooms.agents.features()).identities) throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    } else if (['agent.update', 'agent.archive', 'agent.restore'].includes(method)) {
      const agent = await requireAgent(rooms, p.agentId)
      if (agent.revision !== p.expectedRevision) throw new RemoteNoEffect('REVISION_CONFLICT')
      if (method === 'agent.archive') await this.busy(p.agentId)
      if (agent.executor && (Object.hasOwn(p, 'modelRef') || Object.hasOwn(p, 'fastModelRef')))
        throw new RemoteNoEffect('AGENT_NOT_AVAILABLE')
    }
    if (method === 'agent.create' || method === 'agent.update') {
      const refs = [p.modelRef, p.fastModelRef].filter(Boolean)
      if (refs.length) {
        const choices = await this.choices()
        if (refs.some((ref) => !choices.some((choice) => choice.providerId === ref.providerId && choice.model === ref.model)))
          throw new RemoteNoEffect('MODEL_NOT_AVAILABLE')
      }
    }
  }
  async dispatch(method: string, p: any, envelope: Envelope): Promise<unknown> {
    if (Object.hasOwn(AgentImportParams, method)) return this.importer.dispatch(method, p, envelope)
    if (Object.hasOwn(AgentLifecycleParams, method)) return this.lifecycle.dispatch(method, p, envelope)
    const rooms = this.runtime.rooms!, clientRequestId = receiptKey(envelope, envelope.call.requestId)
    switch (method) {
      case 'agent.avatar.get': return this.avatar.get(p.agentId)
      case 'agent.avatar.update': return this.avatar.update(p, envelope)
      case 'agent.skills.list': return this.catalog.list(method, p, envelope)
      case 'agent.connections.list': return this.catalog.list(method, p, envelope)
      case 'agent.get': return this.get(p.agentId)
      case 'agent.memory.list': return this.memory.list(p)
      case 'agent.memory.update': return this.memory.update(p, clientRequestId)
      case 'agent.memory.candidates.list': return this.candidates.list(p)
      case 'agent.memory.candidates.get': return this.candidates.get(p)
      case 'agent.memory.candidates.decide': return this.candidates.decide(p, clientRequestId)
      case 'agent.memory.history.list': return this.history.list(p)
      case 'agent.memory.history.get': return this.history.get(p)
      case 'agent.runs.list': return this.runs.list(p)
      case 'agent.runs.get': return this.runs.get(p)
      case 'agent.artifacts.list': return this.artifacts.list(p)
      case 'agent.artifacts.get': return this.artifacts.get(p)
      case 'agent.artifacts.versions': return this.artifacts.versions(p)
      case 'agent.reminders.list': return this.reminders.list(p)
      case 'agent.reminders.act': return this.reminders.act(p, envelope)
      case 'agent.commitments.list': return this.commitments.list(p)
      case 'agent.commitments.act': return this.commitments.act(p, clientRequestId)
    }
    if (!this.supports(method)) throw new RemoteNoEffect('INVALID_REQUEST')
    // Recheck inside the same Room mutation queue used by HTTP, then rely on its durable CAS.
    const result = await rooms.exclusive(async () => {
      await this.preflight(method, p)
      try {
        if (method === 'agent.create') return await rooms.agents.create({
          ...Object.fromEntries(Object.entries(p).filter(([, value]) => value !== null)), clientRequestId })
        const { agentId, expectedRevision, ...fields } = p
        return await rooms.agents.update(agentId, { ...fields, expectedRevision, clientRequestId,
          ...(method === 'agent.archive' ? { archived: true } : method === 'agent.restore' ? { archived: false } : {}) })
      } catch (error) {
        if (error instanceof RoomStoreConflictError && error.currentRevision !== null)
          throw new RemoteNoEffect('REVISION_CONFLICT')
        throw error
      }
    })
    return { agent: publicAgent(result.agent) }
  }
}
