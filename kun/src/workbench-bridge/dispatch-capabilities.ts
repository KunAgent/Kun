import { isAbsolute, relative, resolve } from 'node:path'
import type { RoomRequestState } from '../rooms/room-runtime-types.js'
import type { WorkbenchCapabilityCeiling } from '../contracts/thread-workbench-origin.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { ThreadRecord } from '../contracts/threads.js'
import { intersectAllowedToolNames } from '../loop/continuation-instructions.js'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { Room } from '../contracts/rooms.js'
import type { WorkbenchBridge } from './bridge.js'

const union = (...lists: Array<readonly string[] | undefined>) => [...new Set(lists.flatMap((list) => list ?? []))]

/** Capture explicit profile/user constraints, not a phase's advertised tool list. */
export function workbenchDispatchCapabilities(thread: ThreadRecord, context: ToolHostContext,
  request?: RoomRequestState): WorkbenchCapabilityCeiling {
  const member = request?.roomSnapshot.members.find((entry) => entry.id === thread.roomContext?.memberId)
  const allowed = member ? intersectAllowedToolNames(member.presetSnapshot?.allowedTools, member.capabilityOverrides?.allowedTools)
    : thread.roomContext?.allowedToolNames
  const explicitBlocked = member ? union(member.presetSnapshot?.blockedTools, member.capabilityOverrides?.blockedTools)
    : (thread.roomContext?.blockedToolNames ?? []).filter((name) => !['submit_room_plan', 'send_room_message', 'declare_room_checks'].includes(name))
  // Scopes within the source workspace retain their relative restriction in
  // the newly authorized project/worktree, rather than exposing private data.
  const paths = (values?: readonly string[]) => values?.flatMap((path) => {
    const inside = relative(resolve(thread.workspace), resolve(thread.workspace, path))
    return inside !== '..' && !inside.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(inside)
      ? [inside || '.'] : []
  })
  const readPaths = context.allowedReadPaths?.length === 1 && context.allowedReadPaths[0] === '.' ? undefined : paths(context.allowedReadPaths)
  const writePaths = context.allowedWritePaths?.length === 1 && context.allowedWritePaths[0] === '.' ? undefined : paths(context.allowedWritePaths)
  return {
    ...(allowed !== undefined ? { allowedToolNames: [...allowed] } : {}),
    ...(context.allowedProviderIds ? { allowedProviderIds: [...context.allowedProviderIds] } : {}),
    ...(context.allowedSkillIds ? { allowedSkillIds: [...context.allowedSkillIds] } : {}),
    ...(readPaths !== undefined ? { allowedReadPaths: readPaths } : {}),
    ...(writePaths !== undefined ? { allowedWritePaths: writePaths } : {}),
    blockedToolNames: explicitBlocked,
    blockedProviderIds: union(thread.roomContext?.blockedProviderIds, member?.presetSnapshot?.blockedMcpServers, member?.capabilityOverrides?.blockedMcpServers),
    blockedSkillIds: union(thread.roomContext?.blockedSkillIds, member?.presetSnapshot?.blockedSkills, member?.capabilityOverrides?.blockedSkills),
    ...([thread.roomContext?.skillsEnabled, member?.presetSnapshot?.skillsEnabled, member?.capabilityOverrides?.skillsEnabled].includes(false)
      ? { skillsEnabled: false } : thread.roomContext?.skillsEnabled !== undefined ? { skillsEnabled: thread.roomContext.skillsEnabled } : {})
  }
}

/** Live settings may further restrict a pending task, without releasing its frozen ceiling. */
export async function narrowWorkbenchCapabilities(bridge: WorkbenchBridge, roomId: string, memberId: string,
  frozen?: WorkbenchCapabilityCeiling): Promise<WorkbenchCapabilityCeiling> {
  const room = (await bridge.store.get<Room>('room', roomId))?.value
  const member = room?.members.find((entry) => entry.id === memberId)
  const agent = member?.participantAgentId ? (await bridge.store.get<AgentIdentity>('agent_identity', member.participantAgentId))?.value : undefined
  const profile = agent ? bridge.deps.profiles()[agent.presetId] : member?.presetSnapshot
  const allowed = intersectAllowedToolNames(frozen?.allowedToolNames,
    intersectAllowedToolNames(profile?.allowedTools, intersectAllowedToolNames(agent?.capabilityOverrides?.allowedTools, member?.capabilityOverrides?.allowedTools)))
  return { ...frozen, ...(allowed !== undefined ? { allowedToolNames: [...allowed] } : {}),
    blockedToolNames: union(frozen?.blockedToolNames, profile?.blockedTools, agent?.capabilityOverrides?.blockedTools, member?.capabilityOverrides?.blockedTools),
    blockedProviderIds: union(frozen?.blockedProviderIds, agent?.capabilityOverrides?.blockedMcpServers, member?.capabilityOverrides?.blockedMcpServers),
    blockedSkillIds: union(frozen?.blockedSkillIds, agent?.capabilityOverrides?.blockedSkills, member?.capabilityOverrides?.blockedSkills),
    ...([frozen?.skillsEnabled, agent?.capabilityOverrides?.skillsEnabled, member?.capabilityOverrides?.skillsEnabled].includes(false)
      ? { skillsEnabled: false } : {}) }
}
