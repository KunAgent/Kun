import { basename, join, relative } from 'node:path'
import { z } from 'zod'
import { resolveThreadAgentSurface } from '../domain/thread.js'
import type { RoomContentReference } from '../contracts/room-content.js'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { WorkbenchBridge, workbenchBridgeBinding } from './bridge.js'
import { pathWithin } from './directory.js'
import { assertRelativeWorkPath, resolveWorkFile } from './work-files.js'

export const MAX_BOT_REFERENCES = 5

/** What a bot bubble may cite: a Code session or a Work document the Agent is allowed to see. */
export const BotReferenceInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code_thread'), threadId: z.string().min(1).max(256) }).strict(),
  z.object({ kind: z.literal('work_document'), workspaceRoot: z.string().min(1).max(4096), relativePath: z.string().min(1).max(4096) }).strict()
])
export type BotReferenceInput = z.infer<typeof BotReferenceInputSchema>

/** A Code session other modes may cite: a primary Code thread, never a room-owned or deleted one. */
export function citableCodeThread(thread: ThreadRecord | null | undefined): thread is ThreadRecord {
  return Boolean(thread && !thread.roomContext && thread.status !== 'deleted' && resolveThreadAgentSurface(thread) === 'code' &&
    thread.workspaceMode !== 'ade')
}

/**
 * Turns the Agent's references into durable content references, re-checking that
 * its policy and directory limits allow it to see each target.
 */
export async function resolveBotReferences(threads: ThreadStore, participantAgentId: string,
  inputs: readonly BotReferenceInput[]): Promise<RoomContentReference[]> {
  if (!inputs.length) return []
  const bridge = workbenchBridgeBinding(threads)
  if (!bridge) throw new Error('the workbench bridge is unavailable')
  if (inputs.length > MAX_BOT_REFERENCES) throw new Error(`at most ${MAX_BOT_REFERENCES} references per message`)
  const agent = await bridge.agentScope(participantAgentId)
  const references: RoomContentReference[] = []
  for (const input of inputs) {
    if (input.kind === 'code_thread') {
      if (agent.policy.code === 'off') throw new Error('Code access is turned off for this Agent')
      const thread = await bridge.deps.threads.getMetadata(input.threadId)
      if (!citableCodeThread(thread) || !WorkbenchBridge.withinAgentLimits(agent, thread.workspace)) throw new Error('Code thread not found')
      references.push({ kind: 'code_thread', threadId: thread.id, titleSnapshot: thread.title.slice(0, 300) })
      continue
    }
    if (agent.policy.work === 'off') throw new Error('Work access is not enabled for this Agent')
    const real = await bridge.resolveDirectory(input.workspaceRoot)
    const roots = await bridge.directory.readableWorkRoots(agent.allowedRoots)
    const root = real && roots.find((candidate) => candidate === real || pathWithin(candidate, real))
    if (!real || !root) throw new Error('That directory is not a Work workspace this Agent may use')
    // References always name the registered workspace, so opening one lands in Work.
    const relativePath = assertRelativeWorkPath(join(relative(root, real), assertRelativeWorkPath(input.relativePath)).split('\\').join('/'))
    await resolveWorkFile(root, relativePath)
    references.push({ kind: 'work_document', workspaceRoot: root, relativePath, titleSnapshot: basename(relativePath).slice(0, 300) })
  }
  return references
}
