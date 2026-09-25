import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { ROOM_PLAYBOOKS, type RoomPlaybookId } from './room-playbooks.js'
import { roomPlaybookIndex, ROOM_AX_TOOL_DESCRIPTIONS } from './room-ax-surfaces.js'

const Input = z.object({ id: z.string().trim().min(1).max(128).optional() }).strict()
const index = roomPlaybookIndex

export function roomPlaybookTool(threads: ThreadStore) {
  return LocalToolHost.defineTool({
    name: 'read_room_playbook',
    description: ROOM_AX_TOOL_DESCRIPTIONS.read_room_playbook,
    toolKind: 'tool_call', policy: 'auto', sideEffect: 'read-only',
    effects: { network: false, externalWrite: false, processExecution: false, guiAutomation: false },
    shouldAdvertise: (context) => Boolean(context.roomStepKind),
    inputSchema: z.toJSONSchema(Input) as Record<string, unknown>,
    execute: async (args, context) => {
      try {
        const input = Input.parse(args)
        const thread = await (threads.getMetadata?.(context.threadId) ?? threads.get(context.threadId))
        if (!context.roomStepKind || !thread?.roomContext ||
          !thread.turns.some((turn) => turn.id === context.turnId)) throw new Error('room step scope required')
        if (!input.id) return { output: { playbooks: index() } }
        const playbook = ROOM_PLAYBOOKS[input.id as RoomPlaybookId]
        if (!playbook) return { isError: true, output: { error: 'unknown room playbook id', available: index() } }
        return { output: { id: input.id, title: playbook.title, body: playbook.body } }
      } catch (error) {
        return { isError: true, output: { error: error instanceof Error ? error.message : String(error) } }
      }
    }
  })
}
