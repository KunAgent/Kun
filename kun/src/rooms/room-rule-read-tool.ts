import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import type { RoomStore } from './room-store.js'
import type { RoomRequestState, RoomTaskExecution } from './room-runtime-types.js'
import type { RoomContextSnapshot, RoomRule } from '../contracts/rooms-product.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { loadRoomRuleBundle } from './room-rule-compression.js'
import { roomFingerprint } from './room-service.js'
import { ROOM_AX_TOOL_DESCRIPTIONS } from './room-ax-surfaces.js'

const bindings = new WeakMap<ThreadStore, RoomStore>()
export function bindRoomRuleStore(threads: ThreadStore, store: RoomStore) { bindings.set(threads, store) }
const Input = z.object({
  bundleId: z.string().min(1).max(128),
  ruleId: z.string().min(1).max(128).optional(), version: z.number().int().positive().optional(),
  cursor: z.number().int().nonnegative().default(0), offset: z.number().int().nonnegative().default(0)
}).strict()
export async function roomRuleOriginalPage(store: RoomStore, roomId: string, input: z.input<typeof Input>) {
  const body = Input.parse(input)
  const bundle = await loadRoomRuleBundle(store, roomId, body.bundleId)
  const references = bundle.references.filter((ref) => (!body.ruleId || ref.id === body.ruleId) && (!body.version || ref.version === body.version))
  if (body.ruleId && !references.length) throw new Error('agreement version not found')
  if (!body.ruleId) return { references: references.slice(body.cursor, body.cursor + 50),
    total: references.length, nextCursor: body.cursor + 50 < references.length ? body.cursor + 50 : undefined }
  const ref = references[0]
  const row = await store.get<RoomRule>('rule_version', ref.id + '-v' + ref.version)
  if (!row || row.roomId !== roomId || roomFingerprint(row.value.body) !== ref.hash) throw new Error('frozen agreement version unavailable')
  const codePoints = Array.from(row.value.body)
  const text = codePoints.slice(body.offset, body.offset + 1500).join('')
  return { rule: { ...row.value, body: text }, offset: body.offset, totalCharacters: codePoints.length,
    nextOffset: body.offset + 1500 < codePoints.length ? body.offset + 1500 : undefined }
}
export function roomRuleReadTool(threads: ThreadStore) {
  return LocalToolHost.defineTool({
    name: 'read_room_rules', description: ROOM_AX_TOOL_DESCRIPTIONS.read_room_rules,
    toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => Boolean(context.roomStepKind),
    inputSchema: z.toJSONSchema(Input) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const input = Input.parse(args)
        const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
        const store = bindings.get(threads)
        const room = thread?.roomContext
        if (!store || !room || !thread.turns.some((turn) => turn.id === context.turnId)) throw new Error('room step scope required')
        let allowed: string | undefined
        if (room.taskId) {
          const task = await store.get<RoomTaskExecution>('task', room.taskId)
          if (task?.roomId === room.roomId) allowed = task.value.agreements?.bundleId ?? task.value.contextSnapshot?.agreements?.bundleId
        } else {
          const request = room.requestId ? await store.get<RoomRequestState>('request', room.requestId) :
            (await store.list<RoomRequestState>('request', { roomId: room.roomId, threadId: thread.id, limit: 1 }))[0]
          if (request?.roomId === room.roomId) {
            const snapshot = await store.get<RoomContextSnapshot>('context', request.value.contextId ?? 'context-' + request.id)
            if (snapshot?.roomId === room.roomId) allowed = snapshot.value.agreements?.bundleId
          }
        }
        if (input.bundleId !== allowed) throw new Error('agreement bundle is outside this execution snapshot')
        return { output: await roomRuleOriginalPage(store, room.roomId, input) }
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  })
}
