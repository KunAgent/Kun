import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { requireCode } from '../code/access.js'
export async function allowedThread(runtime: ServerRuntime, id: string) {
  const thread = await runtime.threadService.get(id)
  if (!thread) throw new Error('NOT_FOUND')
  if (thread.roomContext) {
    const room = await runtime.rooms!.service.get(thread.roomContext.roomId)
    if (room.conversationKind !== 'user_agent') throw new Error('FORBIDDEN')
    return thread
  }
  return requireCode(runtime, id)
}
