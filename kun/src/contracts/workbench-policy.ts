import { z } from 'zod'

/**
 * How far a private Agent may reach into the user's Code and Work modes.
 * `confirm` always shows a card the user must accept; `auto` starts at once,
 * but only when the request that caused it is a fresh user message.
 */
export const WorkbenchCodePolicySchema = z.enum(['off', 'confirm', 'auto'])
export const WorkbenchWorkPolicySchema = z.enum(['off', 'read', 'confirm', 'auto'])

export const WORKBENCH_MAX_ACTIVE_TASKS_LIMIT = 5

export const AgentWorkbenchPolicySchema = z.object({
  code: WorkbenchCodePolicySchema.default('confirm'),
  work: WorkbenchWorkPolicySchema.default('read'),
  /** Unfinished Code/Work tasks one Agent may have in flight at the same time. */
  maxActiveTasks: z.number().int().min(1).max(WORKBENCH_MAX_ACTIVE_TASKS_LIMIT).default(3)
}).strict()
export type AgentWorkbenchPolicy = z.infer<typeof AgentWorkbenchPolicySchema>

export const DEFAULT_WORKBENCH_POLICY: AgentWorkbenchPolicy = AgentWorkbenchPolicySchema.parse({})

/** Missing or malformed stored policy always resolves to the conservative defaults. */
export function resolveWorkbenchPolicy(value: unknown): AgentWorkbenchPolicy {
  const parsed = AgentWorkbenchPolicySchema.safeParse(value ?? {})
  return parsed.success ? parsed.data : DEFAULT_WORKBENCH_POLICY
}

/** Agent tool names by the capability that gates them. */
export const WORKBENCH_READ_CODE_TOOLS = ['list_code_projects', 'list_code_harnesses', 'search_code_threads', 'read_code_thread'] as const
export const WORKBENCH_WRITE_CODE_TOOLS = ['create_code_task', 'get_code_task', 'message_code_task', 'stop_code_task', 'add_board_card'] as const
export const WORKBENCH_READ_WORK_TOOLS = ['list_work_spaces', 'search_work_documents', 'read_work_document'] as const
export const WORKBENCH_WRITE_WORK_TOOLS = ['create_work_document', 'propose_work_edit', 'create_work_task'] as const
export const WORKBENCH_TOOL_NAMES = [
  ...WORKBENCH_READ_CODE_TOOLS, ...WORKBENCH_WRITE_CODE_TOOLS,
  ...WORKBENCH_READ_WORK_TOOLS, ...WORKBENCH_WRITE_WORK_TOOLS
] as const
export type WorkbenchToolName = typeof WORKBENCH_TOOL_NAMES[number]

/** Tools whose successful result puts a durable card in front of the user. */
export const WORKBENCH_CARD_TOOL_NAMES = [
  'create_code_task', 'add_board_card', 'create_work_document', 'propose_work_edit', 'create_work_task'
] as const

/** Tool names to advertise for a policy, frozen into the private thread's ceiling. */
export function workbenchToolNamesForPolicy(policy: AgentWorkbenchPolicy): WorkbenchToolName[] {
  const names: WorkbenchToolName[] = []
  if (policy.code !== 'off') names.push(...WORKBENCH_READ_CODE_TOOLS, ...WORKBENCH_WRITE_CODE_TOOLS)
  if (policy.work !== 'off') names.push(...WORKBENCH_READ_WORK_TOOLS)
  if (policy.work === 'confirm' || policy.work === 'auto') names.push(...WORKBENCH_WRITE_WORK_TOOLS)
  return names
}
