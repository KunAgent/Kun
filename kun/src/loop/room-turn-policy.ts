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
  const readOnly = !['execution', 'conversation'].includes(policy.kind) || thread.sandboxMode === 'read-only'
  const fullAccess = policy.kind === 'conversation' && thread.sandboxMode === 'danger-full-access'
  const discussionHostReads = policy.kind === 'discussion' && context.allowedReadPaths === undefined
  const agentTools = policy.participantAgentId ? [...AGENT_COLLABORATION_TOOLS] : []
  const peerTools = policy.kind === 'discussion' && policy.collaborationProtocol === 'peer'
    ? ['read_room_updates', 'send_room_message'] : []
  const pollTools = policy.kind === 'discussion' && policy.allowedToolNames?.includes('vote_room_poll') ? ['vote_room_poll'] : []
  // Drafting a proposal is a data-only room protocol; adoption stays a user route.
  const proposalTools = policy.participantAgentId && ['discussion', 'conversation'].includes(policy.kind) ? ['propose_room_action'] : []
  // Replying in a conversation is intrinsic: even read-only or setup-scoped
  // conversations must be able to publish their visible bubbles.
  const conversationTools = policy.kind === 'conversation' ? ['send_im_message'] : []
  const intersected = intersectAllowedToolNames(context.allowedToolNames,
    intersectAllowedToolNames(policy.allowedToolNames ? [...policy.allowedToolNames, 'read_room_rules', 'read_room_playbook', ...peerTools, ...agentTools, ...conversationTools, ...proposalTools] : undefined, policy.kind === 'coordination' ? ['submit_room_plan', 'read_room_rules', 'read_room_playbook', ...agentTools] :
      readOnly ? [...SUBAGENT_READ_ONLY_TOOL_NAMES, 'read_room_rules', 'read_room_playbook', ...peerTools, ...pollTools, ...agentTools, ...conversationTools, ...proposalTools, ...(policy.kind === 'review' ? ['submit_room_review'] : [])] : undefined))
  // Replying is intrinsic to a conversation: a frozen setup or skill allow-list
  // must not drop the publication tool. Explicit blockedToolNames still wins
  // because it is enforced separately at resolution time.
  const allowed = policy.kind === 'conversation' && intersected && !intersected.includes('send_im_message')
    ? [...intersected, 'send_im_message'] : intersected
  return {
    ...context,
    roomStepKind: policy.kind, roomAgent: Boolean(policy.participantAgentId),
    roomPeer: peerTools.length > 0,
    guiRoomExcalidrawCanvas: policy.kind === 'conversation' && context.clientSurface === 'gui' &&
      !readOnly && context.threadMode !== 'plan' && !context.guiPlan,
    workspace: thread.workspace,
    additionalWorkspaces: policy.kind === 'conversation' ? thread.additionalWorkspaces : undefined,
    knowledgeBases: policy.kind === 'conversation' ? thread.knowledgeBases : undefined,
    sandboxMode: readOnly ? 'read-only' : fullAccess ? 'danger-full-access' : 'workspace-write',
    approvalPolicy: thread.approvalPolicy,
    approvalReviewer: thread.approvalReviewer,
    memoryPolicy: { enabled: false },
    allowedToolNames: allowed,
    // Execution and review stay on one checkout. Discussion may read host
    // paths the user names; writes still cannot grow a new mutable root list.
    ...(fullAccess
      ? {
          ...(context.allowedReadPaths ? { allowedReadPaths: context.allowedReadPaths } : {}),
          allowHostReads: undefined
        }
      : discussionHostReads
        ? { allowHostReads: true, allowedReadPaths: undefined }
        : { allowedReadPaths: context.allowedReadPaths ?? ['.'], allowHostReads: undefined }),
    allowedWritePaths: readOnly ? [] : fullAccess ? context.allowedWritePaths : context.allowedWritePaths ?? ['.'],
    allowedSkillIds: policy.skillsEnabled === false ? [] : context.allowedSkillIds,
    blockedSkillIds: mergeRoomDeniedIds(context.blockedSkillIds, policy.blockedSkillIds),
    blockedProviderIds: mergeRoomDeniedIds(context.blockedProviderIds, roomBlockedProviders(thread)),
    blockedToolNames: mergeRoomDeniedIds(context.blockedToolNames, policy.blockedToolNames,
      readOnly ? ['delegate_task', 'generate_subagent'] : [],
      policy.kind === 'conversation' ? [] : ['create_goal'],
      policy.skillsEnabled === false ? ['load_skill', 'load_skill_asset'] : [])
  }
}
