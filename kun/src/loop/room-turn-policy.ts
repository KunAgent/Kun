import type { ThreadRecord } from '../contracts/threads.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import { SUBAGENT_READ_ONLY_TOOL_NAMES } from '../contracts/capabilities-core.js'
import { intersectAllowedToolNames } from './continuation-instructions.js'

export function mergeRoomDeniedIds(...lists: Array<readonly string[] | undefined>): string[] {
  return [...new Set(lists.flatMap((list) => list ?? []))]
}

export function roomBlockedProviders(thread: ThreadRecord): string[] {
  const ids = thread.roomContext?.blockedProviderIds ?? []
  return mergeRoomDeniedIds(ids, ids.map((id) => id.startsWith('mcp:') ? id : `mcp:${id}`))
}

/** Re-applied to both discovery and actual execution, never a model instruction. */
export function applyRoomToolPolicy(context: ToolHostContext, thread: ThreadRecord): ToolHostContext {
  const policy = thread.roomContext
  if (!policy) return context
  const readOnly = policy.kind !== 'execution' || thread.sandboxMode === 'read-only'
  const allowed = intersectAllowedToolNames(context.allowedToolNames,
    intersectAllowedToolNames(policy.allowedToolNames, policy.kind === 'coordination' ? [] :
      readOnly ? SUBAGENT_READ_ONLY_TOOL_NAMES : undefined))
  return {
    ...context,
    workspace: thread.workspace,
    additionalWorkspaces: undefined,
    knowledgeBases: undefined,
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    approvalPolicy: thread.approvalPolicy,
    approvalReviewer: thread.approvalReviewer,
    memoryPolicy: { enabled: false },
    allowedToolNames: allowed,
    // These scopes also block externally approved file writes. A room's
    // authorization is the single task checkout, not a new mutable root list.
    allowedReadPaths: context.allowedReadPaths ?? ['.'],
    allowedWritePaths: readOnly ? [] : context.allowedWritePaths ?? ['.'],
    allowedSkillIds: policy.skillsEnabled === false ? [] : context.allowedSkillIds,
    blockedSkillIds: mergeRoomDeniedIds(context.blockedSkillIds, policy.blockedSkillIds),
    blockedProviderIds: mergeRoomDeniedIds(context.blockedProviderIds, roomBlockedProviders(thread)),
    blockedToolNames: mergeRoomDeniedIds(context.blockedToolNames, policy.blockedToolNames,
      ['delegate_task', 'generate_subagent', 'create_goal'],
      policy.skillsEnabled === false ? ['load_skill', 'load_skill_asset'] : [])
  }
}
