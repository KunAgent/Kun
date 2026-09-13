import { AGENT_COLLABORATION_TOOLS } from '../agents/agent-handoff-tools.js'
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
  const agentTools = policy.participantAgentId ? [...AGENT_COLLABORATION_TOOLS] : []
  const peerTools = policy.kind === 'discussion' && policy.collaborationProtocol === 'peer'
    ? ['read_room_updates', 'send_room_message'] : []
  const pollTools = policy.kind === 'discussion' && policy.allowedToolNames?.includes('vote_room_poll') ? ['vote_room_poll'] : []
  const allowed = intersectAllowedToolNames(context.allowedToolNames,
    intersectAllowedToolNames(policy.allowedToolNames ? [...policy.allowedToolNames, 'read_room_rules', ...peerTools, ...agentTools] : undefined, policy.kind === 'coordination' ? ['submit_room_plan', 'read_room_rules', ...agentTools] :
      readOnly ? [...SUBAGENT_READ_ONLY_TOOL_NAMES, 'read_room_rules', ...peerTools, ...pollTools, ...agentTools, ...(policy.kind === 'review' ? ['submit_room_review'] : [])] : undefined))
  return {
    ...context,
    roomStepKind: policy.kind, roomAgent: Boolean(policy.participantAgentId),
    roomPeer: peerTools.length > 0,
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
