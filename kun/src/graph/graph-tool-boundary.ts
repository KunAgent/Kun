import type { ToolHostContext, ToolProviderKind } from '../ports/tool-host.js'

/** Keep as literals to avoid a cycle with fast-context-tool-provider → capability-registry. */
const FAST_CONTEXT_TOOL_NAME = 'fast_context'
const FAST_CONTEXT_PROVIDER_ID = 'fast-context'

export const GRAPH_LEAD_TOOL_NAMES = [
  'graph_define_plan',
  'graph_create_run',
  'graph_control_run',
  'graph_patch_run',
  'graph_review_node',
  'graph_supervise_node'
] as const

export const GRAPH_WORKER_TOOL_NAMES = [
  'graph_worker_progress',
  'graph_worker_message',
  'graph_worker_receive_messages',
  'graph_worker_publish_artifact',
  'graph_worker_submit_result'
] as const

export const GRAPH_WORKER_REPORT_TOOL_NAME = 'report_to_parent' as const

/**
 * Ordinary orchestration surfaces conflict with host-owned Graph scheduling.
 * Provider-kind filtering covers current and future delegation tools; exact
 * names cover legacy DAG state and built-in wrappers that can spawn a child.
 * Lab `fast_context` is a host-owned, read-only retrieval capability. It is
 * available to Leads and workers without reopening ordinary child fan-out.
 */
export const GRAPH_INCOMPATIBLE_TOOL_NAMES = [
  'delegate_task',
  'list_subagent_profiles',
  'generate_subagent',
  'task_graph',
  'design_component'
] as const

const INCOMPATIBLE_TOOL_NAMES = new Set<string>(GRAPH_INCOMPATIBLE_TOOL_NAMES)
const LEAD_TOOL_NAMES = new Set<string>(GRAPH_LEAD_TOOL_NAMES)
const WORKER_TOOL_NAMES = new Set<string>(GRAPH_WORKER_TOOL_NAMES)
const WORKER_REPORT_TOOL_NAMES = new Set<string>([GRAPH_WORKER_REPORT_TOOL_NAME])

export function isGraphLeadContext(
  context: Pick<ToolHostContext, 'orchestration' | 'messageSource'> | undefined
): boolean {
  return context?.orchestration === 'graph' ||
    context?.messageSource === 'graph_runtime'
}

function isFastContextTool(input: {
  toolName: string
  providerId: string
}): boolean {
  return input.toolName === FAST_CONTEXT_TOOL_NAME ||
    input.providerId === FAST_CONTEXT_PROVIDER_ID
}

export function isToolAllowedInOrchestration(
  input: {
    toolName: string
    providerId: string
    providerKind: ToolProviderKind
  },
  context: Pick<ToolHostContext, 'orchestration' | 'messageSource'> | undefined
): boolean {
  if (!isGraphLeadContext(context)) return true
  // Read-only Lab fast_context stays available on Graph Lead turns so planning can
  // gather repository facts without ordinary delegate_task / child fan-out.
  if (isFastContextTool(input)) return true
  if (input.providerKind === 'delegation' || input.providerId === 'delegation') {
    return false
  }
  return !INCOMPATIBLE_TOOL_NAMES.has(input.toolName)
}

/**
 * Capture only ordinary capabilities that a Graph executor can receive.
 * Graph lifecycle and worker-protocol tools are host/Lead-owned and are never
 * copied into an assignment snapshot.
 */
export function graphParentAuthorityToolNames(toolNames: readonly string[]): string[] {
  return [...new Set(toolNames.filter((name) =>
    !INCOMPATIBLE_TOOL_NAMES.has(name) &&
    !LEAD_TOOL_NAMES.has(name) &&
    !WORKER_TOOL_NAMES.has(name) &&
    !WORKER_REPORT_TOOL_NAMES.has(name)
  ))].sort()
}

export function graphWorkerToolNamesWithin(
  allowedToolNames: readonly string[]
): string[] {
  return [FAST_CONTEXT_TOOL_NAME, GRAPH_WORKER_REPORT_TOOL_NAME]
    .filter((name) => allowedToolNames.includes(name))
}
