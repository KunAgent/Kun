import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import type { RouteContext } from '../router.js'
import type { RoomDelivery } from '../../contracts/room-deliveries.js'
import type { RoomTaskExecution, RoomWorkspace } from '../../rooms/room-runtime-types.js'
import { readRoomLog, preserveRoomLog, roomTextPage, type StoredRoomLog } from '../../rooms/room-evidence-log.js'
import { roomRuleOriginalPage } from '../../rooms/room-rule-read-tool.js'
import { roomTurnItems } from '../../rooms/room-item-history.js'
import { roomGit } from '../../rooms/room-git.js'
type Add = (method: string, path: string, handler: (rooms: RoomRuntime, request: Request, context: RouteContext) => Promise<unknown>) => void
const offset = (request: Request) => z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(new URL(request.url).searchParams.get('cursor') ?? 0)

async function workspace(rooms: RoomRuntime, roomId: string, taskId: string) {
  const task = await rooms.service.store.get<RoomTaskExecution>('task', taskId)
  if (!task || task.roomId !== roomId) throw new Error('task not found')
  const row = await rooms.service.store.get<RoomWorkspace>('workspace', task.value.task.workspaceId)
  if (!row || row.roomId !== roomId || row.taskId !== taskId) throw new Error('workspace not found')
  return row.value
}
async function delivery(rooms: RoomRuntime, roomId: string, taskId: string, id: string) {
  const row = await rooms.service.store.get<RoomDelivery>('delivery', id)
  if (!row || row.roomId !== roomId || row.taskId !== taskId) throw new Error('delivery not found')
  return row.value
}
async function diffPage(root: string, before: string, after: string, request: Request) {
  const query = new URL(request.url).searchParams
  const files = (await roomGit(root, ['diff', '--no-ext-diff', '--name-only', '-z', before, after])).split('\0').filter(Boolean)
  const cursor = offset(request)
  const file = query.get('file')
  if (!file) return { files: files.slice(cursor, cursor + 50), total: files.length,
    nextCursor: cursor + 50 < files.length ? cursor + 50 : undefined }
  if (!files.includes(file)) throw new Error('changed file not found')
  const text = await roomGit(root, ['diff', '--no-ext-diff', '--no-textconv', before, after, '--', file])
  return { file, ...roomTextPage(text, cursor) }
}
export function registerRoomEvidenceRoutes(add: Add) {
  add('GET', '/v1/rooms/:roomId/agreements/:bundleId', async (rooms, request, { params }) => {
    const query = new URL(request.url).searchParams
    return roomRuleOriginalPage(rooms.service.store, params.roomId, { bundleId: params.bundleId,
      ruleId: query.get('rule_id') ?? undefined,
      version: query.has('version') ? z.coerce.number().int().positive().parse(query.get('version')) : undefined,
      cursor: offset(request), offset: query.has('offset') ? z.coerce.number().int().nonnegative().parse(query.get('offset')) : 0 })
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/diff', async (rooms, request, { params }) => {
    const query = new URL(request.url).searchParams
    const to = await delivery(rooms, params.roomId, params.taskId, z.string().min(1).parse(query.get('delivery_id')))
    const from = query.get('from') ? await delivery(rooms, params.roomId, params.taskId, query.get('from')!) : undefined
    return diffPage((await workspace(rooms, params.roomId, params.taskId)).repository.root,
      from?.versionHash ?? to.baseRevision, to.versionHash, request)
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/integrations/:integrationId/diff', async (rooms, request, { params }) => {
    const row = await rooms.integrations.get(params.roomId, params.taskId, params.integrationId)
    const selected = new URL(request.url).searchParams.get('candidate')
    if (selected) {
      const candidate = row.value.candidates?.find((item) => item.pinId === selected)
      if (!candidate?.targetSha) throw new Error('historical candidate base not found')
      return diffPage((await workspace(rooms, params.roomId, params.taskId)).repository.root,
        candidate.targetSha, candidate.sha, request)
    }
    if (!row.value.candidateSha) return { files: [], total: 0, reason: 'Candidate is not frozen; inspect conflicts in the integration worktree.' }
    return diffPage((await workspace(rooms, params.roomId, params.taskId)).repository.root,
      row.value.targetSha, row.value.candidateSha, request)
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/integrations/:integrationId/candidates', async (rooms, request, { params }) => {
    const row = await rooms.integrations.get(params.roomId, params.taskId, params.integrationId)
    const cursor = offset(request)
    const candidates = [...(row.value.candidates ?? [])].reverse()
    return { candidates: candidates.slice(cursor, cursor + 50).map(({ diff: _diff, ...value }) => ({ ...value, id: value.pinId })),
      nextCursor: cursor + 50 < candidates.length ? cursor + 50 : undefined }
  })
  add('GET', '/v1/rooms/:roomId/tasks/:taskId/logs/:artifactId', async (rooms, request, { params }) => {
    const row = await rooms.service.store.get<{ log?: StoredRoomLog; threadId?: string; turnId?: string;
      attempts?: Array<{ callId: string; resultId: string }> }>('artifact', params.artifactId)
    if (!row || row.roomId !== params.roomId || row.taskId !== params.taskId || !row.value.attempts) throw new Error('verification log not found')
    let log = row.value.log
    if (!log && row.value.threadId && row.value.turnId) {
      const thread = await rooms.deps.threads.getMetadata(row.value.threadId)
      const attempt = row.value.attempts[0]
      if (thread?.roomContext?.roomId === params.roomId && thread.roomContext.taskId === params.taskId && attempt) {
        for await (const item of roomTurnItems(rooms.deps.sessions, row.value.threadId, row.value.turnId)) {
          if (item.id === attempt.resultId && item.kind === 'tool_result' && typeof item.output === 'object' && item.output) {
            log = await preserveRoomLog(rooms.deps, params.artifactId, attempt.callId, item.output as Record<string, unknown>,
              { nativeTool: ['bash', 'background_shell'].includes(item.toolName), threadId: row.value.threadId })
            break
          }
        }
      }
    }
    if (!log) return { text: '', bytes: 0, missing: true, reason: 'This historical execution has no retained output.' }
    try { return await readRoomLog(rooms.deps, log, offset(request)) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', bytes: 0, missing: true, reason: 'The retained output file is no longer available.' }
      throw error
    }
  })
}
