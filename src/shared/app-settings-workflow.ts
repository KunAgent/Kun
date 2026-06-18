import {
  WORKFLOW_NODE_KINDS,
  type WorkflowConditionOperator,
  type WorkflowConnectionV1,
  type WorkflowFieldV1,
  type WorkflowHttpHeaderV1,
  type WorkflowHttpMethod,
  type WorkflowNodeKind,
  type WorkflowNodeRunResultV1,
  type WorkflowNodePresetV1,
  type WorkflowNodeRunStatus,
  type WorkflowNodeV1,
  type WorkflowRunV1,
  type WorkflowScheduleV1,
  type WorkflowSwitchRuleV1,
  type WorkflowWebhookMethod,
  type WorkflowSettingsPatchV1,
  type WorkflowSettingsV1,
  type WorkflowTriggerScheduleKind,
  type WorkflowV1
} from './app-settings-types'
import {
  normalizeAtTime,
  normalizeBoolean,
  normalizePositiveInteger,
  normalizeRunMode,
  normalizeScheduleReasoningEffort,
  normalizeStatus,
  normalizeTimeOfDay
} from './app-settings-normalizers'

export const MAX_WORKFLOW_RUNS = 20
const MAX_WORKFLOW_CONNECTIONS = 512
const MAX_WORKFLOW_HTTP_HEADERS = 50
const MAX_WORKFLOW_PRESETS = 100

const CONDITION_OPERATORS: readonly WorkflowConditionOperator[] = [
  'contains',
  'notContains',
  'equals',
  'notEquals',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
  'gt',
  'gte',
  'lt',
  'lte'
]
const HTTP_METHODS: readonly WorkflowHttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asTrimmed(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeWorkflowScheduleKind(value: unknown): WorkflowTriggerScheduleKind {
  if (value === 'interval' || value === 'daily' || value === 'at' || value === 'cron') return value
  return 'manual'
}

function normalizeConditionOperator(value: unknown): WorkflowConditionOperator {
  return CONDITION_OPERATORS.includes(value as WorkflowConditionOperator)
    ? (value as WorkflowConditionOperator)
    : 'contains'
}

function normalizeHttpMethod(value: unknown): WorkflowHttpMethod {
  return HTTP_METHODS.includes(value as WorkflowHttpMethod) ? (value as WorkflowHttpMethod) : 'GET'
}

function normalizeWebhookPath(value: unknown): string {
  const raw = asTrimmed(value)
  if (!raw) return '/webhook'
  return raw.startsWith('/') ? raw : `/${raw}`
}

function normalizeWebhookMethod(value: unknown): WorkflowWebhookMethod {
  return value === 'GET' || value === 'POST' || value === 'PUT' || value === 'PATCH' || value === 'DELETE'
    ? value
    : 'ANY'
}

function normalizeWorkflowSchedule(value: unknown): WorkflowScheduleV1 {
  const s = record(value)
  return {
    kind: normalizeWorkflowScheduleKind(s.kind),
    everyMinutes: normalizePositiveInteger(s.everyMinutes, 60, 1, 10_080),
    timeOfDay: normalizeTimeOfDay(s.timeOfDay),
    atTime: normalizeAtTime(s.atTime),
    cron: asTrimmed(s.cron)
  }
}

function normalizePosition(value: unknown): { x: number; y: number } {
  const p = record(value)
  const x = typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : 0
  const y = typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : 0
  return { x, y }
}

function normalizeHttpHeaders(value: unknown): WorkflowHttpHeaderV1[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const r = record(entry)
      return { key: asTrimmed(r.key), value: asText(r.value) }
    })
    .filter((header) => header.key)
    .slice(0, MAX_WORKFLOW_HTTP_HEADERS)
}

function normalizeFields(value: unknown): WorkflowFieldV1[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const r = record(entry)
      return { key: asTrimmed(r.key), value: asText(r.value) }
    })
    .filter((field) => field.key)
    .slice(0, MAX_WORKFLOW_HTTP_HEADERS)
}

function normalizeSwitchRules(value: unknown): WorkflowSwitchRuleV1[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      const r = record(entry)
      return {
        leftExpr: asText(r.leftExpr),
        operator: normalizeConditionOperator(r.operator),
        rightValue: asText(r.rightValue),
        caseSensitive: normalizeBoolean(r.caseSensitive, false)
      }
    })
    .slice(0, 20)
}

export function normalizeWorkflowNode(value: unknown, index: number): WorkflowNodeV1 | null {
  const n = record(value)
  const type = n.type
  if (typeof type !== 'string' || !WORKFLOW_NODE_KINDS.includes(type as WorkflowNodeKind)) return null
  const kind = type as WorkflowNodeKind
  const base = {
    id: asTrimmed(n.id) || `node-${index + 1}`,
    name: asTrimmed(n.name),
    position: normalizePosition(n.position),
    disabled: normalizeBoolean(n.disabled, false)
  }
  const config = record(n.config)
  switch (kind) {
    case 'manual-trigger':
      return { ...base, type: 'manual-trigger', config: {} }
    case 'schedule-trigger':
      return { ...base, type: 'schedule-trigger', config: { schedule: normalizeWorkflowSchedule(config.schedule) } }
    case 'webhook-trigger':
      return {
        ...base,
        type: 'webhook-trigger',
        config: { path: normalizeWebhookPath(config.path), method: normalizeWebhookMethod(config.method) }
      }
    case 'ai-agent':
      return {
        ...base,
        type: 'ai-agent',
        config: {
          prompt: asText(config.prompt),
          workspaceRoot: asTrimmed(config.workspaceRoot),
          providerId: asTrimmed(config.providerId),
          model: asTrimmed(config.model),
          reasoningEffort: normalizeScheduleReasoningEffort(config.reasoningEffort),
          mode: normalizeRunMode(config.mode)
        }
      }
    case 'generate-image':
      return {
        ...base,
        type: 'generate-image',
        config: {
          prompt: asText(config.prompt),
          providerId: asTrimmed(config.providerId),
          model: asTrimmed(config.model),
          size: asTrimmed(config.size),
          outputDir: asTrimmed(config.outputDir)
        }
      }
    case 'condition':
      return {
        ...base,
        type: 'condition',
        config: {
          leftExpr: asText(config.leftExpr),
          operator: normalizeConditionOperator(config.operator),
          rightValue: asText(config.rightValue),
          caseSensitive: normalizeBoolean(config.caseSensitive, false)
        }
      }
    case 'switch':
      return {
        ...base,
        type: 'switch',
        config: {
          rules: normalizeSwitchRules(config.rules),
          fallback: normalizeBoolean(config.fallback, true)
        }
      }
    case 'filter':
      return {
        ...base,
        type: 'filter',
        config: {
          leftExpr: asText(config.leftExpr),
          operator: normalizeConditionOperator(config.operator),
          rightValue: asText(config.rightValue),
          caseSensitive: normalizeBoolean(config.caseSensitive, false)
        }
      }
    case 'set-fields':
      return {
        ...base,
        type: 'set-fields',
        config: {
          fields: normalizeFields(config.fields),
          keepIncoming: normalizeBoolean(config.keepIncoming, false)
        }
      }
    case 'sort':
      return {
        ...base,
        type: 'sort',
        config: {
          field: asTrimmed(config.field),
          order: config.order === 'desc' ? 'desc' : 'asc',
          numeric: normalizeBoolean(config.numeric, false)
        }
      }
    case 'limit':
      return {
        ...base,
        type: 'limit',
        config: {
          count: normalizePositiveInteger(config.count, 10, 1, 100_000),
          from: config.from === 'last' ? 'last' : 'first'
        }
      }
    case 'aggregate':
      return {
        ...base,
        type: 'aggregate',
        config: {
          mode:
            config.mode === 'sum' || config.mode === 'collect' || config.mode === 'join' ? config.mode : 'count',
          field: asTrimmed(config.field),
          separator: asText(config.separator)
        }
      }
    case 'code':
      return {
        ...base,
        type: 'code',
        config: {
          language: config.language === 'python' || config.language === 'bash' ? config.language : 'javascript',
          code: asText(config.code)
        }
      }
    case 'merge':
      return {
        ...base,
        type: 'merge',
        config: { mode: config.mode === 'object' ? 'object' : 'array' }
      }
    case 'subworkflow':
      return {
        ...base,
        type: 'subworkflow',
        config: { workflowId: asTrimmed(config.workflowId) }
      }
    case 'loop':
      return {
        ...base,
        type: 'loop',
        config: {
          workflowId: asTrimmed(config.workflowId),
          maxIterations: normalizePositiveInteger(config.maxIterations, 10, 1, 100),
          leftExpr: asText(config.leftExpr),
          operator: normalizeConditionOperator(config.operator),
          rightValue: asText(config.rightValue),
          caseSensitive: normalizeBoolean(config.caseSensitive, false)
        }
      }
    case 'http-request':
      return {
        ...base,
        type: 'http-request',
        config: {
          method: normalizeHttpMethod(config.method),
          url: asTrimmed(config.url),
          headers: normalizeHttpHeaders(config.headers),
          body: asText(config.body),
          timeoutMs: normalizePositiveInteger(config.timeoutMs, 30_000, 1_000, 600_000),
          parseJson: normalizeBoolean(config.parseJson, false)
        }
      }
    case 'delay':
      return {
        ...base,
        type: 'delay',
        config: { delayMs: normalizePositiveInteger(config.delayMs, 1_000, 0, 86_400_000) }
      }
    default:
      return null
  }
}

function normalizeConnections(value: unknown, nodeIds: Set<string>): WorkflowConnectionV1[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: WorkflowConnectionV1[] = []
  value.forEach((entry, index) => {
    const r = record(entry)
    const source = asTrimmed(r.source)
    const target = asTrimmed(r.target)
    // Drop dangling edges so the execution engine never references a missing node.
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return
    const id = asTrimmed(r.id) || `edge-${index + 1}`
    if (seen.has(id)) return
    seen.add(id)
    out.push({
      id,
      source,
      sourceHandle: asTrimmed(r.sourceHandle) || 'out',
      target,
      targetHandle: asTrimmed(r.targetHandle) || 'in'
    })
  })
  return out.slice(0, MAX_WORKFLOW_CONNECTIONS)
}

function normalizeNodeRunStatus(value: unknown): WorkflowNodeRunStatus {
  if (value === 'running' || value === 'success' || value === 'error' || value === 'skipped') return value
  return 'pending'
}

function normalizeNodeResult(value: unknown): WorkflowNodeRunResultV1 {
  const r = record(value)
  return {
    nodeId: asTrimmed(r.nodeId),
    status: normalizeNodeRunStatus(r.status),
    startedAt: asTrimmed(r.startedAt),
    finishedAt: asTrimmed(r.finishedAt),
    message: asText(r.message),
    outputJson: asText(r.outputJson),
    threadId: asTrimmed(r.threadId),
    error: asText(r.error)
  }
}

function normalizeRun(value: unknown, index: number): WorkflowRunV1 {
  const r = record(value)
  return {
    id: asTrimmed(r.id) || `run-${index + 1}`,
    trigger: asTrimmed(r.trigger) || 'manual',
    status: normalizeStatus(r.status),
    startedAt: asTrimmed(r.startedAt),
    finishedAt: asTrimmed(r.finishedAt),
    message: asText(r.message),
    nodeResults: Array.isArray(r.nodeResults) ? r.nodeResults.map(normalizeNodeResult) : []
  }
}

export function normalizeWorkflow(workflow: Partial<WorkflowV1>, index: number, now: string): WorkflowV1 {
  const w = workflow ?? {}
  const nodes = Array.isArray(w.nodes)
    ? w.nodes
        .map((node, nodeIndex) => normalizeWorkflowNode(node, nodeIndex))
        .filter((node): node is WorkflowNodeV1 => node !== null)
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const connections = normalizeConnections(w.connections, nodeIds)
  const runs = Array.isArray(w.runs)
    ? w.runs.map((run, runIndex) => normalizeRun(run, runIndex)).slice(-MAX_WORKFLOW_RUNS)
    : []
  return {
    id: asTrimmed(w.id) || `workflow-${index + 1}`,
    name: asTrimmed(w.name) || `Workflow ${index + 1}`,
    enabled: normalizeBoolean(w.enabled, true),
    nodes,
    connections,
    createdAt: asTrimmed(w.createdAt) || now,
    updatedAt: asTrimmed(w.updatedAt) || now,
    lastRunAt: asTrimmed(w.lastRunAt),
    nextRunAt: asTrimmed(w.nextRunAt),
    lastStatus: normalizeStatus(w.lastStatus),
    lastMessage: asText(w.lastMessage),
    runs
  }
}

export function defaultWorkflowSettings(): WorkflowSettingsV1 {
  return {
    enabled: false,
    defaultWorkspaceRoot: '',
    providerId: '',
    model: '',
    mode: 'agent',
    keepAwake: false,
    webhookPort: 8799,
    webhookSecret: '',
    workflows: [],
    presets: []
  }
}

function normalizeNodePreset(value: unknown, index: number): WorkflowNodePresetV1 | null {
  const p = record(value)
  // Reuse the node normalizer so the preset's saved config is validated per kind.
  const node = normalizeWorkflowNode({ type: p.nodeType, name: p.nodeName, config: p.config }, index)
  if (!node) return null
  return {
    id: asTrimmed(p.id) || `preset-${index}`,
    label: asTrimmed(p.label) || node.name || node.type,
    icon: asTrimmed(p.icon),
    nodeType: node.type,
    nodeName: node.name,
    config: node.config
  }
}

export function normalizeWorkflowSettings(input: WorkflowSettingsPatchV1 | undefined): WorkflowSettingsV1 {
  const defaults = defaultWorkflowSettings()
  const source = input ?? {}
  const now = new Date().toISOString()
  return {
    enabled: normalizeBoolean(source.enabled, defaults.enabled),
    defaultWorkspaceRoot: asTrimmed(source.defaultWorkspaceRoot),
    providerId: asTrimmed(source.providerId),
    model: asTrimmed(source.model),
    mode: normalizeRunMode(source.mode),
    keepAwake: normalizeBoolean(source.keepAwake, defaults.keepAwake),
    webhookPort: normalizePositiveInteger(source.webhookPort, defaults.webhookPort, 1024, 65_535),
    webhookSecret: asTrimmed(source.webhookSecret),
    workflows: Array.isArray(source.workflows)
      ? source.workflows.map((workflow, index) => normalizeWorkflow(workflow as Partial<WorkflowV1>, index, now))
      : [],
    presets: Array.isArray(source.presets)
      ? source.presets
          .map((preset, index) => normalizeNodePreset(preset, index))
          .filter((preset): preset is WorkflowNodePresetV1 => preset !== null)
          .slice(0, MAX_WORKFLOW_PRESETS)
      : []
  }
}

export function mergeWorkflowSettings(
  current: WorkflowSettingsV1,
  patch: WorkflowSettingsPatchV1 | undefined
): WorkflowSettingsV1 {
  if (!patch) return normalizeWorkflowSettings(current)
  return normalizeWorkflowSettings({
    ...current,
    ...patch,
    workflows: patch.workflows ?? current.workflows,
    presets: patch.presets ?? current.presets
  })
}
