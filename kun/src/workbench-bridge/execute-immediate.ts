import { readFile } from 'node:fs/promises'
import type { WorkbenchLink, WorkbenchResult } from '../contracts/workbench-links.js'
import type { RoomStoredDocument } from '../rooms/room-store.js'
import type { WorkbenchBridge } from './bridge.js'
import { updateWorkbenchLink } from './link-store.js'
import { createWorkFile, replaceWorkFile, resolveWorkFile, sha256 } from './work-files.js'

/** Links that finish inside one action instead of running an Agent turn. */
export const IMMEDIATE_KINDS: readonly WorkbenchLink['kind'][] = ['work_document', 'work_edit', 'board_card']

/** Ids currently being executed by this process, so a slow action is not started twice. */
const inFlight = new Set<string>()

const done = (summary: string, extra: Partial<WorkbenchResult> = {}): WorkbenchResult =>
  ({ summary, finalExcerpt: '', changedFiles: [], commands: [], finishedAt: new Date().toISOString(), ...extra })

async function perform(bridge: WorkbenchBridge, link: WorkbenchLink): Promise<WorkbenchResult> {
  const scope = await bridge.agentScope(link.participantAgentId)
  const request = link.request
  if (link.kind === 'board_card') {
    if (scope.policy.code === 'off') throw new Error('This Agent is no longer allowed to change the project board.')
    if (!bridge.projectBoard || !request.workspaceRoot || !request.board) throw new Error('The project board is unavailable.')
    const snapshot = await bridge.projectBoard.createManualCard({ workspace: request.workspaceRoot, title: request.title,
      description: request.board.description, status: 'pending', category: request.board.category, priority: request.board.priority } as never)
    const card = [...snapshot.cards].reverse().find((item) => item.kind === 'manual' && item.title === request.title)
    return done(`Added board card "${request.title}".`, { ...(card ? { cardId: card.id } : {}) })
  }
  if (scope.policy.work === 'off' || scope.policy.work === 'read') throw new Error('This Agent is no longer allowed to change Work documents.')
  const roots = await bridge.directory.writableWorkRoots(scope.allowedRoots)
  const root = request.workspaceRoot && roots.find((candidate) => candidate === request.workspaceRoot)
  if (!root || !request.relativePath) throw new Error('The Work workspace is no longer available for writing.')
  if (link.kind === 'work_document') {
    const path = await createWorkFile(root, request.relativePath, request.content ?? '')
    return done(`Created ${request.relativePath}.`, { path, changedFiles: [request.relativePath] })
  }
  if (!request.edits || !request.baseSha256) throw new Error('The edit is incomplete.')
  const path = await replaceWorkFile(root, request.relativePath, request.edits, request.baseSha256)
  return done(`Applied ${request.edits.length} edit${request.edits.length === 1 ? '' : 's'} to ${request.relativePath}.`,
    { path, changedFiles: [request.relativePath] })
}

/**
 * After a crash mid-action the effect may or may not exist. A document create
 * or edit is recognized exactly by content hash; anything unclear goes to the
 * user instead of being repeated.
 */
async function recoverInterrupted(link: WorkbenchLink): Promise<{ result: WorkbenchResult } | { retry: true } | { unsure: true }> {
  const { request } = link
  if (!request.workspaceRoot || !request.relativePath || link.kind === 'board_card') return { unsure: true }
  let current: Buffer | undefined
  try { current = await readFile(await resolveWorkFile(request.workspaceRoot, request.relativePath)) } catch { current = undefined }
  if (link.kind === 'work_document') {
    if (!current) return { retry: true }
    return sha256(current) === sha256(request.content ?? '')
      ? { result: done(`Created ${request.relativePath}.`, { changedFiles: [request.relativePath] }) } : { unsure: true }
  }
  // Edit: an untouched document proves nothing was written; any other content is for the user to judge.
  return current && sha256(current) === request.baseSha256 ? { retry: true } : { unsure: true }
}

/** Run one accepted immediate link to completion, exactly once per process and idempotently across restarts. */
export async function executeImmediateLink(bridge: WorkbenchBridge, row: RoomStoredDocument<WorkbenchLink>): Promise<void> {
  const link = row.value
  if (inFlight.has(link.id)) return
  inFlight.add(link.id)
  try {
    if (link.status === 'running') {
      // Claimed by an earlier process that never recorded the outcome.
      const outcome = await recoverInterrupted(link)
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => 'result' in outcome
        ? { status: 'completed', result: outcome.result }
        : 'retry' in outcome ? { status: 'queued' }
          : { status: 'recovery_required', error: 'The action may have completed before the runtime stopped. Check the result before asking again.' })
      return
    }
    const claimed = await updateWorkbenchLink(bridge.store, link.roomId, link.id,
      (current) => current.status === 'queued' ? { status: 'running' } : null, { expectedRevision: row.revision }).catch(() => null)
    if (!claimed || claimed.status !== 'running') return
    try {
      const result = await perform(bridge, link)
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'completed', result }))
    } catch (error) {
      await updateWorkbenchLink(bridge.store, link.roomId, link.id, () => ({ status: 'failed',
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) }))
    }
  } finally { inFlight.delete(link.id) }
}
