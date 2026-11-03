import type { ToolBlock } from '../../agent/types'

type Translate = (key: string, opts?: Record<string, unknown>) => string

const READ_TOOLS = new Set([
  'read', 'read_file', 'read_many_files', 'view_file', 'read_source_history', 'knowledge_read'
])
const SEARCH_TOOLS = new Set([
  'grep', 'grep_files', 'search_files', 'find', 'glob', 'fast_context', 'explore_agent',
  'web_search', 'search'
])
const EDIT_TOOLS = new Set([
  'write', 'write_file', 'edit', 'edit_file', 'apply_patch', 'multi_edit', 'str_replace', 'delete'
])
const RUN_TOOLS = new Set(['bash', 'shell', 'background_shell', 'execute'])
const LIST_TOOLS = new Set(['ls', 'list_dir', 'list'])
const DELEGATE_TOOLS = new Set(['delegate_task', 'generate_subagent', 'spawn_agent'])

/**
 * Short, action-only label for the live status row.
 *
 * Deliberately ignores tool arguments: paths, search patterns, shell commands
 * and raw summaries stay in the expandable process detail instead of stretching
 * the one-line progress label. Classification trusts the structured tool name
 * and tool kind, never the rendered summary text.
 */
export function summarizeToolLiveAction(block: ToolBlock, t: Translate): string {
  const acp = typeof block.meta?.acpKind === 'string' ? block.meta.acpKind : ''
  const acpNames: Record<string, string> = { read: 'read', search: 'search', execute: 'shell',
    edit: 'edit', delete: 'edit', move: 'edit', 'fs.write': 'write' }
  const toolName = acpNames[acp] ?? (typeof block.meta?.toolName === 'string'
    ? block.meta.toolName.trim().toLowerCase() : '')
  // Localized fallbacks keep non-en/zh locales readable if the live keys are
  // not translated there yet.
  const read = (): string => t('toolLiveActionRead', { defaultValue: t('toolBuiltinRead') })
  const search = (): string => t('toolLiveActionSearch', { defaultValue: t('toolBuiltinGrep') })
  const edit = (): string => t('toolLiveActionEdit', { defaultValue: t('toolBuiltinEdit') })
  const run = (): string => t('toolLiveActionRun', { defaultValue: t('toolActionCommand') })
  const list = (): string => t('toolLiveActionList', { defaultValue: t('toolBuiltinLs') })
  const delegate = (): string => t('toolLiveActionDelegate', { defaultValue: t('toolActionTool') })
  const generic = (): string => t('toolLiveActionGeneric', { defaultValue: t('toolActionTool') })

  if (block.toolKind === 'command_execution') return run()
  if (READ_TOOLS.has(toolName)) return read()
  if (SEARCH_TOOLS.has(toolName)) return search()
  if (EDIT_TOOLS.has(toolName) || block.toolKind === 'file_change') return edit()
  if (RUN_TOOLS.has(toolName)) return run()
  if (LIST_TOOLS.has(toolName)) return list()
  if (DELEGATE_TOOLS.has(toolName)) return delegate()
  return generic()
}

/**
 * Child-agent activity projected into the parent turn's live status. A nested
 * tool contributes only its action word; phases without a tool return
 * undefined so the parent row keeps its own wording.
 */
export function childActivityLiveAction(
  activity: { phase?: string; toolName?: string },
  t: Translate
): string | undefined {
  const toolName = typeof activity.toolName === 'string' ? activity.toolName.trim().toLowerCase() : ''
  if (!toolName) return undefined
  return summarizeToolLiveAction({
    kind: 'tool',
    id: 'child-activity',
    summary: toolName,
    status: 'running',
    meta: { toolName }
  }, t)
}
