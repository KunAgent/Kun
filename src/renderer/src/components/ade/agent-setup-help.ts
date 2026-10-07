import i18n from '../../i18n'
import { useHarnessStore } from '../../store/harness-store'
import { openAgentConversationRoom } from '../rooms/agent-chat-navigation'
import { roomRequestId, roomsClient, roomsRequest } from '../rooms/rooms-client'
import { appendRoomDraft, resolveBotRoomId } from '../rooms/workbench-bridge-actions'

/**
 * Hands a failed third-party Agent install or update to the default 小 Kun
 * chat: the error, command, versions and log tail are drafted into its
 * private conversation, which then opens. Nothing is sent until the user does.
 */
export type AgentSetupIssue = {
  harnessId: string
  operation: 'install' | 'adapter' | 'update'
  command?: string
  error?: string
  output?: string
  currentVersion?: string
  currentPath?: string
  targetVersion?: string
}

const LOG_TAIL_CHARS = 6_000
const tr = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'common', ...options })

function logTail(output: string): string {
  const trimmed = output.trim()
  const tail = trimmed.length > LOG_TAIL_CHARS ? '…' + trimmed.slice(-LOG_TAIL_CHARS) : trimmed
  // A fence inside the log would close the draft's code block early.
  return tail.replace(/```/g, "'''")
}

export function agentSetupHelpPrompt(issue: AgentSetupIssue, agentName: string): string {
  const current = [issue.currentVersion, issue.currentPath].filter(Boolean).join(' · ')
  const facts = [
    tr('agentIntegrations.askKunPrompt.agent', { agent: agentName, id: issue.harnessId }),
    issue.command ? tr('agentIntegrations.askKunPrompt.command', { command: issue.command }) : '',
    current ? tr('agentIntegrations.askKunPrompt.current', { current }) : '',
    issue.targetVersion ? tr('agentIntegrations.askKunPrompt.target', { version: issue.targetVersion }) : '',
    issue.error?.trim() ? tr('agentIntegrations.askKunPrompt.error', { error: issue.error.trim() }) : ''
  ].filter(Boolean).map((line) => `- ${line}`)
  const log = issue.output ? logTail(issue.output) : ''
  return [
    tr('agentIntegrations.askKunPrompt.intro', { agent: agentName, operation: tr(`agentIntegrations.askKunOperation.${issue.operation}`) }),
    '',
    ...facts,
    ...(log ? ['', tr('agentIntegrations.askKunPrompt.log'), '```text', log, '```'] : []),
    '',
    tr('agentIntegrations.askKunPrompt.instructions')
  ].join('\n')
}

/** 小 Kun's private chat; if it was deleted or archived, the most recent other private chat. */
async function defaultKunRoomId(): Promise<string> {
  const entry = await roomsRequest<{ roomId?: string }>('/v1/agents/chat-entry', 'POST', { action: 'initialize', clientRequestId: roomRequestId() })
  if (entry.roomId) {
    const room = await roomsClient.get(entry.roomId).then((result) => result.room, () => null)
    if (room && !room.deletedAt && !room.archivedAt) return room.id
  }
  const fallback = await resolveBotRoomId('agent-chat')
  if (!fallback || fallback === entry.roomId) throw new Error(tr('agentIntegrations.askKunUnavailable'))
  return fallback
}

export async function askKunAboutAgentSetup(issue: AgentSetupIssue): Promise<void> {
  const agentName = useHarnessStore.getState().rows.find((row) => row.definition.id === issue.harnessId)?.definition.displayName ?? issue.harnessId
  const roomId = await defaultKunRoomId()
  appendRoomDraft(roomId, { body: agentSetupHelpPrompt(issue, agentName) })
  openAgentConversationRoom(roomId)
}
