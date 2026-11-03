import { OPERATION_METHODS, OPERATION_READ_METHODS, READ_METHODS, validateOperationParams } from '@kun/remote-protocol'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { Router } from '../server/router.js'
import { PolicyMutationRejected } from '../domain/remote-policy-revision.js'
import { Envelope, ParamSchemas, type Method } from './contracts.js'
import { AgentParamSchemas } from './agents/contracts.js'
import { AgentConversationParamSchemas } from './agents/conversation-contracts.js'
import { CodeTaskParamSchemas } from './code/contracts.js'
import { ApprovalParamSchemas } from './approvals/contracts.js'
import { MessageParamSchemas } from './messages/contracts.js'
import { RequestParamSchemas } from './requests/contracts.js'
import { RemoteReceipts } from './requests/receipts.js'
import { RemoteNoEffect } from './requests/rejections.js'
import { localCaller } from './runtime/local-call.js'
import { authorizeRemoteOperation } from './authorization/scopes.js'
import { RemoteAttachmentAdmissions } from './files/admissions.js'
import { RemoteArtifacts } from './files/artifacts.js'
import { RemoteProjectFiles } from './files/projects.js'
import { RemoteArtifactDirectory } from './files/artifact-directory.js'
import { ProjectFilesParamSchemas } from './files/project-contracts.js'
import { RemoteApprovals } from './approvals/service.js'
import { RemoteApprovalQueries } from './approvals/queries.js'
import { RemoteAgents } from './agents/service.js'
import { RemoteAgentConversations } from './agents/conversations.js'
import { RemoteAgentSearch } from './agents/search.js'
import { remoteAgentDirectory } from './agents/directory.js'
import { RemoteCodeManagement } from './code/management.js'
import { CodeManagementParamSchemas } from './code/contracts.js'
import { RemoteCodeTasks } from './code/tasks.js'
import { RemoteCodeHistory } from './code/history/service.js'
import { CodeHistoryParamSchemas } from './code/history/contracts.js'
import { RemoteExecutionQueue } from './execution/queue.js'
import { RemoteExecutionStop } from './execution/stop.js'
import { ExecutionQueueParamSchemas } from './execution/contracts.js'
import { RemoteGoals } from './goals/service.js'
import { GoalParamSchemas } from './goals/contracts.js'
import { RemoteMessages } from './messages/service.js'
import { RemoteSourceContent } from './messages/source/content.js'
import { RemoteAttention } from './attention/service.js'
import { RemoteGroups } from './groups/service.js'
import { GroupParamSchemas, GroupWriteParamSchemas } from './groups/contracts.js'
import { RemoteCollaboration } from './collaboration/service.js'
import { RemoteSchedules } from './schedules/service.js'
import { RemotePlugins } from './plugins/service.js'
import { remoteCatalog, remoteCapabilityDescriptors } from './catalog.js'

const strictMethods = new Set<string>(OPERATION_METHODS)
const readMethods = new Set<string>([...READ_METHODS, ...OPERATION_READ_METHODS, 'approval.prepare'])

/** Fixed remote use cases over native services; transport admission and receipts stay here. */
export class RemoteFacade {
  readonly artifacts: RemoteArtifacts
  readonly projectFiles: RemoteProjectFiles
  readonly groups: RemoteGroups
  private readonly receipts: RemoteReceipts
  private readonly approvals: RemoteApprovals
  private readonly approvalQueries: RemoteApprovalQueries
  private readonly agents: RemoteAgents
  private readonly conversations: RemoteAgentConversations
  private readonly agentSearch: RemoteAgentSearch
  private readonly code: RemoteCodeManagement
  private readonly tasks: RemoteCodeTasks
  private readonly history: RemoteCodeHistory
  private readonly queue: RemoteExecutionQueue
  private readonly stop: RemoteExecutionStop
  private readonly goals: RemoteGoals
  private readonly messages: RemoteMessages
  private readonly source: RemoteSourceContent
  private readonly attention: RemoteAttention
  private readonly artifactDirectory: RemoteArtifactDirectory
  private readonly collaboration: RemoteCollaboration
  private readonly schedules: RemoteSchedules
  private readonly plugins: RemotePlugins
  private readonly attachmentAdmissions: RemoteAttachmentAdmissions
  private readonly handlers = new Map<string, (scope: Envelope, params: any) => Promise<unknown>>()

  constructor(private runtime: ServerRuntime, router: Router) {
    const call = localCaller(router, runtime)
    this.artifacts = new RemoteArtifacts(runtime)
    this.receipts = new RemoteReceipts(runtime.rooms!)
    this.approvals = new RemoteApprovals(runtime, call)
    this.conversations = new RemoteAgentConversations(runtime, call)
    this.approvalQueries = new RemoteApprovalQueries(runtime, call, this.conversations)
    this.agents = new RemoteAgents(runtime, call)
    this.agentSearch = new RemoteAgentSearch(runtime)
    this.code = new RemoteCodeManagement(runtime, () => this.tasks.models())
    this.history = new RemoteCodeHistory(runtime)
    this.tasks = new RemoteCodeTasks(runtime, call, this.code, this.history, this.artifacts)
    this.queue = new RemoteExecutionQueue(runtime, call)
    this.stop = new RemoteExecutionStop(runtime, call, this.conversations)
    this.goals = new RemoteGoals(runtime)
    this.projectFiles = new RemoteProjectFiles(runtime)
    this.messages = new RemoteMessages(runtime)
    this.source = new RemoteSourceContent(runtime)
    this.attention = new RemoteAttention(runtime)
    this.artifactDirectory = new RemoteArtifactDirectory(runtime, this.artifacts)
    this.groups = new RemoteGroups(runtime)
    this.collaboration = new RemoteCollaboration(runtime)
    this.schedules = new RemoteSchedules(runtime)
    this.plugins = new RemotePlugins(runtime)
    this.attachmentAdmissions = new RemoteAttachmentAdmissions(runtime)
    this.registerHandlers()
  }

  async execute(raw: unknown) {
    const envelope = Envelope.parse(raw), { method } = envelope.call
    authorizeRemoteOperation(envelope, method)
    try {
      if (strictMethods.has(method)) validateOperationParams(method as import('@kun/remote-protocol').RemoteMethod, envelope.call.params)
    } catch { throw new Error('INVALID_REQUEST') }
    const params = ParamSchemas[method].parse(envelope.call.params)
    if (method === 'request.get') return this.lookup(envelope, (params as { requestId: string }).requestId)
    if (strictMethods.has(method) && !readMethods.has(method) && !await this.receipts.get(envelope, envelope.call.requestId)) {
      try { await this.preflight(envelope, params) }
      catch (error) {
        if (!(error instanceof RemoteNoEffect)) throw error
        return { receipt: await this.receipts.execute(envelope, async () => { throw error }) }
      }
    }
    // Agent/model picks are refused before a receipt exists, so the refusal is certain.
    if (method === 'code.create' && !await this.receipts.get(envelope, envelope.call.requestId)) await this.tasks.route(params)
    const run = () => this.dispatch(envelope, params)
    if (readMethods.has(method)) return run()
    return { receipt: await this.receipts.execute(envelope, run) }
  }

  private async preflight(envelope: Envelope, params: any) {
    const { method } = envelope.call
    if (Object.hasOwn(GroupParamSchemas, method)) return this.groups.preflight(method, params, envelope)
    if (method === 'plugin.setEnabled') return this.plugins.preflight(envelope, params)
    if (Object.hasOwn(CodeManagementParamSchemas, method)) return this.code.preflight(method, params)
    try {
      if (this.history.supports(method)) return await this.history.preflight(method, params)
      if (this.agents.supports(method)) return await this.agents.preflight(method, params)
      if (Object.hasOwn(ExecutionQueueParamSchemas, method)) return await this.queue.preflight(method, params)
      if (Object.hasOwn(GoalParamSchemas, method)) return await this.goals.preflight(method, params)
    } catch (error) {
      if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code)
      throw error
    }
  }

  private async lookup(scope: Envelope, id: string) {
    const receipt = await this.receipts.get(scope, id)
    if (receipt) authorizeRemoteOperation(scope, receipt.method, true)
    if (receipt?.status !== 'reconciliation_required' || !receipt.params) return { receipt }
    const method = receipt.method
    let result: unknown
    if (method === 'code.create' || method === 'code.turn.start') result = await this.tasks.recover(scope, receipt)
    else if (method === 'agent.message.send') result = await this.conversations.recover(scope, receipt)
    else if (this.history.supports(method)) result = await this.history.recover(scope, receipt)
    else if (this.agents.supports(method)) result = await this.agents.recover(scope, receipt)
    else if (Object.hasOwn(ExecutionQueueParamSchemas, method)) result = await this.queue.recover(scope, receipt)
    else if (Object.hasOwn(GroupWriteParamSchemas, method)) result = await this.groups.recoverMutation(scope, receipt)
    else if (method === 'plugin.setEnabled') result = await this.plugins.recover(scope, receipt)
    else if (method === 'group.message.send' && typeof receipt.params.roomId === 'string')
      result = await this.groups.recover(scope, receipt.params.roomId, receipt.requestId)
    return { receipt: result === undefined ? receipt : await this.receipts.recovered(scope, id, result) }
  }

  conversation(agentId: string) { return this.conversations.conversation(agentId) }

  operationMethods(): readonly string[] { return [...this.handlers.keys()] }

  private registerHandlers() {
    const add = (schemas: object, handler: (scope: Envelope, params: any) => Promise<unknown>) => {
      for (const method of Object.keys(schemas)) {
        if (this.handlers.has(method)) throw new Error('DUPLICATE_REMOTE_OPERATION')
        this.handlers.set(method, handler)
      }
    }
    add(CodeManagementParamSchemas, async ({ call }, p) => {
      if (call.method === 'code.search') return this.code.search(p)
      if (call.method === 'code.settings.get') return this.code.settings(p.threadId)
      if (call.method === 'code.settings.update') return this.code.updateSettings(p)
      return this.code.mutate(call.method, p)
    })
    add(AgentParamSchemas, (scope, p) => this.agents.dispatch(scope.call.method, p, scope))
    add(AgentConversationParamSchemas, (scope, p) => this.conversations.dispatch(scope, p))
    add(CodeTaskParamSchemas, (scope, p) => this.tasks.dispatch(scope, p))
    add(ExecutionQueueParamSchemas, (scope, p) => this.queue.dispatch(scope.call.method, p, scope))
    add(GoalParamSchemas, (scope, p) => this.goals.dispatch(scope.call.method, p))
    add(ProjectFilesParamSchemas, (scope, p) => scope.call.method === 'file.preview'
      ? this.projectFiles.preview(scope, p) : this.projectFiles.page(scope, p))
    add(GroupWriteParamSchemas, (scope, p) => this.groups.mutate(scope, scope.call.method, p, scope.call.requestId))
    add(MessageParamSchemas, (scope, p) => scope.call.method === 'message.source.get' ? this.source.get(p)
      : scope.call.method === 'message.search' ? this.messages.search(p) : this.messages.get(p))
    add(ApprovalParamSchemas, (scope, p) => scope.call.method === 'approval.prepare' ? this.approvals.prepare(scope, p.approvalId)
      : scope.call.method === 'approval.resolve' ? this.approvals.resolve(scope, p) : this.approvalQueries.dispatch(scope, p))
    add(RequestParamSchemas, (scope, p) => this.lookup(scope, p.requestId))
    add(CodeHistoryParamSchemas, (scope, p) => this.history.dispatch(scope.call.method, p, scope))
    const single: Partial<Record<Method, (scope: Envelope, p: any) => Promise<unknown>>> = {
      'catalog.get': (scope) => remoteCatalog(this.runtime, scope, () => this.tasks.models(),
        () => remoteCapabilityDescriptors(this.runtime, scope, this.agents, this.source)),
      'agent.search': (_scope, p) => this.agentSearch.search(p),
      'agent.directory.list': (scope, p) => remoteAgentDirectory(this.runtime, scope, p),
      'attention.list': (_scope, p) => this.attention.list(p),
      'artifact.list': (_scope, p) => this.artifactDirectory.list(p),
      'execution.stop': (scope, p) => this.stop.stop(scope, p),
      'group.get': (scope, p) => this.groups.get(scope, p),
      'group.list': (scope, p) => this.groups.list(scope, p),
      'group.history': (scope, p) => this.groups.history(scope, p),
      'group.message.send': (scope, p) => this.groups.send(scope, p, scope.call.requestId),
      'collaboration.runs.list': (scope, p) => this.collaboration.runs(scope, p),
      'collaboration.tasks.list': (scope, p) => this.collaboration.tasks(scope, p),
      'schedule.list': (scope, p) => this.schedules.list(scope, p),
      'schedule.runs.list': (scope, p) => this.schedules.runs(scope, p),
      'plugin.catalog': (scope, p) => this.plugins.catalog(scope, p),
      'plugin.view': (scope, p) => this.plugins.view(scope, p),
      'plugin.setEnabled': (scope, p) => this.plugins.setEnabled(scope, p, scope.call.requestId)
    }
    for (const [method, handler] of Object.entries(single)) add({ [method]: true }, handler!)
    if (this.handlers.size !== Object.keys(ParamSchemas).length || Object.keys(ParamSchemas).some((method) => !this.handlers.has(method)))
      throw new Error('REMOTE_OPERATION_REGISTRATION_INCOMPLETE')
  }

  private async dispatch(envelope: Envelope, params: any): Promise<unknown> {
    await this.attachmentAdmissions.assert(envelope, envelope.call.method, params)
    const handler = this.handlers.get(envelope.call.method)
    if (!handler) throw new Error('UNSUPPORTED_OPERATION')
    return handler(envelope, params)
  }
}
