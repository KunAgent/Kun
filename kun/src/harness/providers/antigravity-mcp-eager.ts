import { CHART_TOOL_NAME } from '../../adapters/tool/chart-tool-provider.js'
import { COMPONENT_DESIGN_TOOL_NAME } from '../../adapters/tool/component-design-tool-provider.js'
import { CONVERSATION_VISUALIZATION_TOOL_NAME } from '../../adapters/tool/conversation-visualization-tool-provider.js'
import { DESIGN_OPEN_EXCALIDRAW_TOOL_NAME } from '../../adapters/tool/design-excalidraw-tool.js'
import { DESIGN_OPEN_TOOL_NAME } from '../../adapters/tool/design-open-tool.js'
import { DIAGRAM_VISUALIZATION_TOOL_NAME } from '../../adapters/tool/diagram-visualization-tool-provider.js'
import { REPORT_OPEN_TOOL_NAME } from '../../adapters/tool/report-open-tool.js'
import type { AcpMcpListedTool } from './provider-module.js'

/**
 * Antigravity CLI enforces a ~60 KB eager MCP tool schema budget packed
 * smallest-first. Marking every bridged tool `alwaysLoad` overflows that cap
 * and silently drops larger core tools (`design_open`, `report_open`,
 * `user_input`, etc.) without demoting them to lazy loading. Keep Kun's eager
 * footprint well below the cap so prioritized tools always load eagerly while
 * remaining tools fall back cleanly to Antigravity's lazy `call_mcp_tool` path.
 */
export const ANTIGRAVITY_EAGER_MAX_BYTES = 46_000
export const ANTIGRAVITY_MAX_EAGER_TOOLS = 64
// agy exposes MCP tools as `mcp_kun-tools_<name>` under Gemini's 64-char name limit.
export const ANTIGRAVITY_EAGER_TOOL_NAME = /^[a-zA-Z0-9_.:-]{1,50}$/

const ALWAYS_LOAD_META: Readonly<Record<string, unknown>> = Object.freeze({
  'antigravity/alwaysLoad': true
})

const PRIORITY_EAGER_TOOL_NAMES: readonly string[] = [
  // Tier 0: Kun GUI surfaces, protocol-required gates, worker callbacks, MCP gateway, skills.
  DESIGN_OPEN_TOOL_NAME,
  COMPONENT_DESIGN_TOOL_NAME,
  DESIGN_OPEN_EXCALIDRAW_TOOL_NAME,
  REPORT_OPEN_TOOL_NAME,
  CHART_TOOL_NAME,
  'render_widget',
  DIAGRAM_VISUALIZATION_TOOL_NAME,
  CONVERSATION_VISUALIZATION_TOOL_NAME,
  'create_plan',
  'user_input',
  'request_user_input',
  'submit_result',
  'report_progress',
  'ask_manager',
  'read_manager_context',
  'mcp_search',
  'mcp_describe',
  'mcp_call',
  'mcp_read_only_call',
  'load_skill',
  'load_skill_asset',
  'read_artifact',
  // Tier 1: High-value Kun-exclusive desktop, notebook, media, office, and dispatch tools.
  'notebook_run_cells',
  'notebook_variables',
  'colab_status',
  'colab_run',
  'colab_stop',
  'generate_image',
  'office_inspect',
  'office_preview',
  'office_edit',
  'ppt_import_asset',
  'ppt_preview',
  'ppt_export',
  'git_inspect',
  'verify_changes',
  'send_im_attachment',
  'get_goal',
  'create_goal',
  'update_goal',
  'harness_list',
  'worker_create',
  'worker_status',
  'worker_read',
  'worker_send',
  'worker_verdict',
  'worker_answer',
  'worker_approve',
  'worker_stop',
  'worker_release',
  'workspace_integrate',
  'workspace_run_checks',
  'review_request',
  'worker_create_batch',
  'dispatch_intent_status',
  'dispatch_intent_cancel',
  'generate_video',
  'generate_music',
  'gmail_connect',
  'gmail_search',
  'gmail_read',
  'gmail_send',
  'github_connect',
  'github_list_tools',
  'github_read',
  'task_create',
  'task_get',
  'task_list',
  'task_update'
]

const PRIORITY_RANK = new Map<string, number>(
  PRIORITY_EAGER_TOOL_NAMES.map((name, rank) => [name, rank])
)

export function estimateAntigravityMcpToolBytes(tool: Pick<AcpMcpListedTool, 'name' | 'description' | 'inputSchema'>): number {
  return Buffer.byteLength(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }),
    'utf8'
  )
}

export function selectAntigravityMcpToolListMeta(
  tools: readonly AcpMcpListedTool[],
  options: { maxBytes?: number; maxTools?: number } = {}
): Array<Record<string, unknown> | undefined> {
  const maxBytes = options.maxBytes ?? ANTIGRAVITY_EAGER_MAX_BYTES
  const maxTools = options.maxTools ?? ANTIGRAVITY_MAX_EAGER_TOOLS
  const result: Array<Record<string, unknown> | undefined> = new Array(tools.length).fill(undefined)

  const candidates: Array<{ index: number; rank: number; bytes: number }> = []
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]!
    if (!ANTIGRAVITY_EAGER_TOOL_NAME.test(tool.name)) continue
    const explicitRank = PRIORITY_RANK.get(tool.name)
    // Leave external MCP server tools (e.g. GitHub/Playwright/Canvas) lazy so they
    // never crowd out Kun's core surfaces; they stay reachable via call_mcp_tool and mcp_call.
    if (explicitRank === undefined && tool.providerKind === 'mcp') continue
    candidates.push({
      index,
      rank: explicitRank ?? PRIORITY_EAGER_TOOL_NAMES.length + index,
      bytes: estimateAntigravityMcpToolBytes(tool)
    })
  }

  candidates.sort((left, right) => left.rank - right.rank || left.index - right.index)

  let usedBytes = 0
  let usedTools = 0
  for (const candidate of candidates) {
    if (usedTools >= maxTools) break
    if (usedBytes + candidate.bytes > maxBytes) continue
    result[candidate.index] = { ...ALWAYS_LOAD_META }
    usedBytes += candidate.bytes
    usedTools += 1
  }

  return result
}
