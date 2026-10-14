import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { allowedThread } from './routing.js'

/** Workspace scope alone is too broad for the restricted phone surface. */
export async function remoteAttachmentContent(runtime: ServerRuntime, threadId: string, id: string) {
  const thread = await allowedThread(runtime, threadId)
  const metadata = await runtime.attachmentStore?.get(id)
  if (!metadata) throw new Error('FILE_NOT_ALLOWED')
  let referenced = metadata.threadIds.includes(threadId)
  // Older attachments may only have a workspace scope. Prove an actual transcript reference.
  if (!referenced && runtime.sessionStore.loadItemPage) {
    let before: string | undefined
    const seen = new Set<string>()
    do {
      const page = await runtime.sessionStore.loadItemPage(threadId, { before, maxItems: 200, maxBytes: 512 * 1024 })
      if (page.items.some((item) => 'attachmentIds' in item && item.attachmentIds?.includes(id))) {
        referenced = true
        break
      }
      if (!page.hasMore) break
      if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('HISTORY_UNAVAILABLE')
      before = page.nextCursor
      seen.add(before)
    } while (before)
  }
  if (!referenced) throw new Error('FILE_NOT_ALLOWED')
  return runtime.attachmentStore!.resolveContent(id, { threadId: thread.id, workspace: thread.workspace })
}
