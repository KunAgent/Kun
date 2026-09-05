import type { ToolHostContext } from '../../ports/tool-host.js'
import type { LocalTool } from './local-tool-host.js'

export type PlanModeToolBlock = {
  code: 'plan_mode_write_blocked'
  message: string
}

/**
 * Generated media is a deliberate Plan-mode exception: users should be able
 * to create or iterate an image without switching the conversation back to
 * Agent mode. Keep this list narrow because these tools persist workspace
 * artifacts even though they do not modify project source files.
 */
export const PLAN_MODE_ALLOWED_GENERATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'generate_image'
])

/** Read-only names used for Plan-mode model guidance, not capability authorization. */
export const PLAN_MODE_READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'read',
  'ls',
  'glob',
  'grep',
  'find',
  'repo_map',
  'git_inspect',
  'lsp',
  'web_search',
  'web_fetch'
])

/** Interactive names used for Plan-mode model guidance, not capability authorization. */
export const PLAN_MODE_INTERACTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'user_input',
  'request_user_input'
])

/** Host-constrained tools which may persist only the reserved plan artifact. */
export const PLAN_MODE_HOST_CONSTRAINED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_plan'
])

export function isPlanModeToolContext(
  context: Pick<ToolHostContext, 'threadMode' | 'guiPlan'>
): boolean {
  return context.threadMode === 'plan' || Boolean(context.guiPlan)
}

/**
 * Decides whether a host-resolved tool may run in Plan mode. The classification
 * is host-authored: missing or unknown metadata is intentionally denied.
 */
export function isPlanModeToolAllowed(
  tool: Pick<LocalTool, 'name' | 'sideEffect'>
): boolean {
  return PLAN_MODE_HOST_CONSTRAINED_TOOL_NAMES.has(tool.name) ||
    PLAN_MODE_ALLOWED_GENERATION_TOOL_NAMES.has(tool.name) ||
    tool.sideEffect === 'read-only'
}

/**
 * Plan mode may only execute host-classified read-only tools plus explicit,
 * host-constrained exceptions. This is defense in depth for forged calls and
 * capabilities that bypass catalog discovery.
 */
export async function planModeToolBlock(
  tool: Pick<LocalTool, 'name' | 'sideEffect'>,
  _call: unknown,
  context: ToolHostContext
): Promise<PlanModeToolBlock | null> {
  if (!isPlanModeToolContext(context) || isPlanModeToolAllowed(tool)) return null
  return {
    code: 'plan_mode_write_blocked',
    message:
      `Plan mode cannot execute tool ${tool.name} because it is not host-classified as read-only. ` +
      'Use read-only investigation tools and save the reserved implementation plan with create_plan; switch to Agent mode before performing mutations.'
  }
}
