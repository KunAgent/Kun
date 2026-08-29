import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import {
  buildFastContextEvidencePack,
  type FastContextEvidencePack,
  type FastContextTask
} from '../../delegation/fast-context-evidence.js'
import {
  ModelReasoningEffort,
  type SubagentProfileConfig
} from '../../contracts/capabilities.js'
import type { ToolExecutionUpdate, ToolHostContext } from '../../ports/tool-host.js'
import type { CapabilityToolProvider } from './capability-registry.js'
import { LocalToolHost } from './local-tool-host.js'

export const FAST_CONTEXT_TOOL_NAME = 'fast_context' as const
export const FAST_CONTEXT_PROVIDER_ID = 'fast-context' as const
export const FAST_CONTEXT_QUEUE_TIMEOUT_MS = 30_000

export type FastContextToolConfig = {
  enabled?: boolean
  model?: string
  providerId?: string
  reasoningEffort?: ModelReasoningEffort
  fast?: boolean
}

/** Fast Context's managed source-tool boundary. */
export const FAST_CONTEXT_ALLOWED_TOOLS = ['grep', 'glob', 'read'] as const

const FAST_CONTEXT_LABEL = 'Fast Context retrieval'
const FAST_CONTEXT_SYSTEM_PROMPT = [
  'You are Kun’s budgeted repository retrieval agent.',
  'You may only use grep, glob, and read. Do not use shell, web, repo maps, skills, mutation, or delegation.',
  'Emit no more than four source tool calls in one model round; continue a larger investigation in the next retrieval round.',
  'Keep source inspection narrow and return concise task conclusions with file-and-line evidence.'
].join(' ')
const FAST_CONTEXT_PROMPT_PREAMBLE = [
  'You are Kun’s budgeted repository retrieval agent.',
  'Use only grep, glob, and read. Use rounds 1-3 to locate candidates, target those paths, and read small relevant ranges.',
  'Emit no more than four source tool calls in one model round. Continue remaining independent lookups in the next retrieval round.',
  'Round 4 is final synthesis only: do not call a tool during that round.',
  'Do not use shell, web, repo maps, skills, or any mutation. Do not dump raw tool output.',
  'Finish with concise sections headed “Task 1:”, “Task 2:”, and so on. State uncertainty when source evidence is incomplete.'
].join(' ')

const FAST_CONTEXT_DESCRIPTION = [
  'Run a Fast Context repository retrieval before broad code exploration. Submit 1-4 scoped tasks together; one budgeted child investigates them as a single retrieval run.',
  'The child can only use grep, glob, and read, has at most four model steps, executes at most four source calls concurrently, and returns compact file-and-line evidence instead of raw search output.',
  'Use a later fast_context call for questions that depend on this evidence. 即使后续需要修改文件，也必须先调用 fast_context；复杂问题请在一个批次中提交 2-4 个互不重叠的任务。'
].join(' ')

/**
 * First-class budgeted repository retriever. `tasks` remains a 1-4 item API,
 * but all tasks share one child and one global source-tool budget.
 */
export function buildFastContextToolProvider(
  runtime: DelegationRuntime | undefined,
  config: () => FastContextToolConfig | undefined
): CapabilityToolProvider[] {
  if (!runtime?.enabled()) return []
  const shouldAdvertise = (_context: ToolHostContext): boolean => config()?.enabled !== false
  return [{
    id: FAST_CONTEXT_PROVIDER_ID,
    kind: 'delegation',
    enabled: true,
    available: true,
    tools: [LocalToolHost.defineTool({
      name: FAST_CONTEXT_TOOL_NAME,
      description: FAST_CONTEXT_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array', minItems: 1, maxItems: 4,
            description: 'One Fast Context wave of 1-4 scoped retrieval tasks. Dependent questions belong in a later wave.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', minLength: 1, description: 'Short task title.' },
                query: { type: 'string', minLength: 1, description: 'Scoped repository question and expected evidence.' }
              },
              required: ['title', 'query'], additionalProperties: false
            }
          }
        },
        required: ['tasks'], additionalProperties: false
      },
      policy: 'auto',
      sideEffect: 'read-only',
      shouldAdvertise,
      execute: async (args, context, onUpdate) => {
        const cfg = config()
        if (cfg?.enabled === false) return { output: { error: 'fast_context is disabled in Lab settings' }, isError: true }
        const parsed = parseExploreTasks(args.tasks)
        if ('error' in parsed) return { output: { error: parsed.error }, isError: true }
        // The model never chooses a sandbox root. It may only retrieve inside
        // the immutable workspace captured by the parent tool context.
        const workspace = context.workspace
        const state = new FastContextRunState(parsed.tasks, onUpdate)
        try {
          const record = await runtime.runChild({
            parentThreadId: context.threadId,
            parentTurnId: context.turnId,
            launcher: 'fast_context',
            label: FAST_CONTEXT_LABEL,
            prompt: fastContextPrompt(parsed.tasks),
            workspace,
            inlineProfile: buildFastContextInlineProfile(cfg ?? {}),
            agentSurface: context.agentSurface ?? 'code',
            inheritSessionDefaults: true,
            ...(cfg?.fast === true ? { serviceTier: 'priority' as const } : {}),
            ...(context.serviceTier ? { inheritedServiceTier: context.serviceTier } : {}),
            ...inheritedModelRoute(context),
            ...(context.reasoningEffort?.trim() ? { inheritedReasoningEffort: context.reasoningEffort.trim() } : {}),
            security: securitySnapshot(workspace, context),
            approvalPolicy: context.approvalPolicy,
            ...(context.sandboxMode ? { sandboxMode: context.sandboxMode } : {}),
            approvalReviewer: context.approvalReviewer ?? 'user',
            ...(context.clientSurface ? { clientSurface: context.clientSurface } : {}),
            returnFormat: 'summary',
            fastContext: true,
            fastContextTasks: parsed.tasks,
            queueTimeoutMs: FAST_CONTEXT_QUEUE_TIMEOUT_MS,
            onQueued: async (childId, _profile, metadata) => state.update({
              childId, status: 'queued', model: resolveExploreModel(metadata?.model, context),
              profileName: metadata?.profileName?.trim() || 'Repository Explorer'
            }),
            onRunning: async (childId, _profile, metadata) => state.update({
              childId, status: 'running', model: resolveExploreModel(metadata?.model, context),
              profileName: metadata?.profileName?.trim() || 'Repository Explorer'
            }),
            signal: context.abortSignal
          })
          await state.finish(record, context)
        } catch (error) {
          await state.fail(context.abortSignal.aborted ? 'aborted' : 'failed', errorMessage(error))
        }
        const output = state.output()
        return { output, isError: output.status === 'failed' || output.status === 'aborted' }
      }
    })]
  }]
}

type ExploreStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

type FastContextOutput = {
  status: ExploreStatus
  childId?: string
  label: string
  title: string
  launcher: 'fast_context'
  profile: 'explore'
  profileName: string
  model?: string
  error?: string
  failure?: { source: 'model' | 'runtime' | 'contract'; code?: string; category?: string }
  queuedMs?: number
  toolInvocations?: number
  durationMs?: number
  parentThreadId?: string
  parentTurnId?: string
  terminationReason?: 'user_stop' | 'manual_stop' | 'runtime_restart' | 'child_error'
  resumable?: boolean
  resumeCount?: number
  evidencePack: FastContextEvidencePack
  child: {
    childId?: string
    status: ExploreStatus
    profile: 'explore'
    profileName: string
    model?: string
    parentThreadId?: string
    parentTurnId?: string
    launcher: 'fast_context'
  }
}

class FastContextRunState {
  private status: ExploreStatus = 'queued'
  private childId: string | undefined
  private model: string | undefined
  private profileName = 'Repository Explorer'
  private record: Awaited<ReturnType<DelegationRuntime['runChild']>> | undefined
  private error: string | undefined
  private pack: FastContextEvidencePack
  private emission = Promise.resolve()

  constructor(
    private readonly tasks: FastContextTask[],
    private readonly onUpdate: ((update: ToolExecutionUpdate) => Promise<void> | void) | undefined
  ) {
    this.pack = emptyEvidencePack(tasks)
  }

  output(): FastContextOutput {
    const record = this.record
    const child = compact({
      childId: this.childId,
      status: this.status,
      profile: 'explore' as const,
      profileName: this.profileName,
      model: this.model,
      parentThreadId: record?.parentThreadId,
      parentTurnId: record?.parentTurnId,
      launcher: 'fast_context' as const
    })
    return compact({
      status: this.status,
      childId: this.childId,
      label: FAST_CONTEXT_LABEL,
      title: FAST_CONTEXT_LABEL,
      launcher: 'fast_context' as const,
      profile: 'explore' as const,
      profileName: this.profileName,
      model: this.model,
      error: this.error,
      failure: record?.failure,
      queuedMs: record?.queuedMs,
      toolInvocations: record?.toolInvocations,
      durationMs: record?.durationMs,
      parentThreadId: record?.parentThreadId,
      parentTurnId: record?.parentTurnId,
      terminationReason: record?.terminationReason,
      resumable: record?.resumable,
      resumeCount: record?.resumeCount,
      evidencePack: this.pack,
      child
    })
  }

  async emit(): Promise<void> {
    if (!this.onUpdate) return
    const snapshot = this.output()
    this.emission = this.emission.then(async () => this.onUpdate?.({ output: snapshot, isError: false }))
    await this.emission
  }

  async update(patch: { childId?: string; status?: ExploreStatus; model?: string; profileName?: string }): Promise<void> {
    if (patch.childId) this.childId = patch.childId
    if (patch.status && statusRank(patch.status) >= statusRank(this.status)) this.status = patch.status
    if (patch.model) this.model = patch.model
    if (patch.profileName) this.profileName = patch.profileName
    await this.emit()
  }

  async finish(record: Awaited<ReturnType<DelegationRuntime['runChild']>>, context: ToolHostContext): Promise<void> {
    this.record = record
    this.childId = record.id
    this.status = record.status
    this.model = resolveExploreModel(record.model, context)
    this.profileName = record.profileSnapshot?.name?.trim() || this.profileName
    this.error = record.status === 'failed' || record.status === 'aborted' ? record.error ?? record.status : undefined
    this.pack = record.evidencePack ?? buildFastContextEvidencePack({
      tasks: this.tasks,
      items: [],
      turnId: '',
      summary: record.summary,
      ...(this.error ? { failure: this.error } : {})
    })
    await this.emit()
  }

  async fail(status: 'failed' | 'aborted', error: string): Promise<void> {
    this.status = status
    this.error = error
    this.pack = buildFastContextEvidencePack({ tasks: this.tasks, items: [], turnId: '', failure: error })
    await this.emit()
  }
}

function buildFastContextInlineProfile(cfg: FastContextToolConfig): { id: string; profile: SubagentProfileConfig; source: 'builtin' } {
  const model = cfg.model?.trim()
  const providerId = cfg.providerId?.trim()
  const reasoningEffort = ModelReasoningEffort.safeParse(cfg.reasoningEffort).success ? cfg.reasoningEffort : undefined
  return {
    id: 'explore', source: 'builtin',
    profile: {
      mode: 'subagent', toolPolicy: 'readOnly', skillsEnabled: false,
      allowedTools: [...FAST_CONTEXT_ALLOWED_TOOLS],
      blockedTools: ['delegate_task', 'generate_subagent', 'load_skill'],
      systemPrompt: FAST_CONTEXT_SYSTEM_PROMPT,
      promptPreamble: FAST_CONTEXT_PROMPT_PREAMBLE,
      ...(model && providerId ? { model, providerId } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {})
    }
  }
}

function fastContextPrompt(tasks: readonly FastContextTask[]): string {
  return [
    'Investigate this batch as one Fast Context retrieval run.',
    'Use rounds 1-3 only for retrieval: locate candidate files, grep only candidate paths, then read necessary local ranges.',
    'Emit no more than four grep, glob, or read calls in one model round. Continue any remaining lookup in the next retrieval round.',
    'Round 4 is final synthesis only. Do not call a tool in round 4; write the task conclusions instead.',
    `Every grep, glob, and read call must include a non-empty task_indexes array of 1-based task numbers (1-${tasks.length}); include every task supported by shared evidence.`,
    'Use the minimum source calls needed. Do not request broad recursive scans after candidates are known.',
    'Your final response must contain one concise `Task N:` conclusion for every task, with uncertainty where evidence is missing.',
    ...tasks.map((task, index) => `Task ${index + 1}: ${task.title}\n${task.query}`)
  ].join('\n\n')
}

function securitySnapshot(workspace: string, context: ToolHostContext) {
  return {
    sandboxRoot: workspace,
    ...(context.allowedProviderIds ? { allowedProviderIds: [...context.allowedProviderIds] } : {}),
    ...(context.allowedToolNames ? { allowedToolNames: [...context.allowedToolNames] } : {}),
    ...(context.allowedSkillIds ? { allowedSkillIds: [...context.allowedSkillIds] } : {}),
    // A Fast Context child never inherits full-access filesystem reach. An
    // explicit read scope remains a parent upper bound; otherwise `.` pins
    // every source tool to the captured workspace root.
    allowedReadPaths: context.allowedReadPaths ? [...context.allowedReadPaths] : ['.'],
    ...(context.allowedWritePaths ? { allowedWritePaths: [...context.allowedWritePaths] } : {}),
    ...(context.allowedArtifactIds ? { allowedArtifactIds: [...context.allowedArtifactIds] } : {}),
    ...(context.blockedProviderIds ? { blockedProviderIds: [...context.blockedProviderIds] } : {}),
    ...(context.blockedToolNames ? { blockedToolNames: [...context.blockedToolNames] } : {}),
    ...(context.blockedSkillIds ? { blockedSkillIds: [...context.blockedSkillIds] } : {}),
    memoryEnabled: false
  }
}

function inheritedModelRoute(context: ToolHostContext) {
  return {
    ...(context.actingModelRoute?.model ? { inheritedModel: context.actingModelRoute.model } : context.model?.id?.trim() ? { inheritedModel: context.model.id.trim() } : {}),
    ...(context.actingModelRoute?.providerId ? { inheritedProviderId: context.actingModelRoute.providerId } : context.modelProviderId?.trim() ? { inheritedProviderId: context.modelProviderId.trim() } : {}),
    ...(context.actingModelRoute?.accountId ? { inheritedAccountId: context.actingModelRoute.accountId } : {})
  }
}

function emptyEvidencePack(tasks: readonly FastContextTask[]): FastContextEvidencePack {
  return buildFastContextEvidencePack({ tasks, items: [], turnId: '' })
}

function parseExploreTasks(value: unknown): { tasks: FastContextTask[] } | { error: string } {
  if (!Array.isArray(value)) return { error: 'tasks must be an array with 1-4 items' }
  if (value.length < 1) return { error: 'tasks must contain at least 1 item' }
  if (value.length > 4) return { error: 'tasks must contain at most 4 items' }
  const tasks: FastContextTask[] = []
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { error: `tasks[${index}] must be an object` }
    const task = candidate as Record<string, unknown>
    const title = stringValue(task.title)
    const query = stringValue(task.query)
    if (!title) return { error: `tasks[${index}].title is required` }
    if (!query) return { error: `tasks[${index}].query is required` }
    tasks.push({ title: title.slice(0, 240), query: query.slice(0, 4_000) })
  }
  return { tasks }
}

function statusRank(status: ExploreStatus): number {
  return status === 'queued' ? 0 : status === 'running' ? 1 : 2
}

function resolveExploreModel(model: string | undefined, context: ToolHostContext): string | undefined {
  return model?.trim() || context.actingModelRoute?.model?.trim() || context.model?.id?.trim() || undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500)
}
