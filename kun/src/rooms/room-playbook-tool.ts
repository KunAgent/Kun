import { z } from 'zod'
import type { ThreadStore } from '../ports/thread-store.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { ROOM_PLAYBOOKS, type RoomPlaybookId } from './room-playbooks.js'

const Input = z.object({ id: z.string().trim().min(1).max(128).optional() }).strict()
const index = () => (Object.keys(ROOM_PLAYBOOKS) as RoomPlaybookId[]).map((id) => ({
  id, title: ROOM_PLAYBOOKS[id].title, triggers: ROOM_PLAYBOOKS[id].triggers
}))

export function roomPlaybookTool(threads: ThreadStore) {
  return LocalToolHost.defineTool({
    name: 'read_room_playbook',
    description: 'Read an on-demand room collaboration playbook. Call without id for the index (id, title, triggers), or with an id for one full playbook: converging a discussion, evidence handoffs, coordinator synthesis, external actions, asking the user, or deferred follow-up.',
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
