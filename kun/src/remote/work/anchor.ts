import { isAbsolute, relative } from 'node:path'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { ThreadRecord } from '../../contracts/threads.js'

const SCAN_ITEMS = 40, SCAN_BYTES = 256 * 1024, CACHE = 512
/** The line a phone adds when a session starts from a document; the desktop records the same fact as a composer reference. */
const DOCUMENT_LINE = /^>?\s*(?:当前文档|Current document)[:：]\s*(.{1,1024})$/
const cache = new WeakMap<ServerRuntime, Map<string, string | null>>()

function fromContexts(contexts: unknown) {
  if (!Array.isArray(contexts)) return undefined
  for (const context of contexts) {
    const reference = (context as { reference?: { kind?: unknown; locator?: unknown } })?.reference
    if (reference?.kind === 'work-reference-resource' && typeof reference.locator === 'string' && reference.locator) return reference.locator
  }
  return undefined
}
function fromText(text: unknown) {
  if (typeof text !== 'string') return undefined
  return DOCUMENT_LINE.exec(text.split('\n', 1)[0].trim())?.[1]?.trim()
}
/** Stays inside the space when shown: an absolute locator becomes relative, anything outside is dropped. */
function spaceRelative(root: string, locator: string) {
  const path = (isAbsolute(locator) ? relative(root, locator) : locator).replace(/\\/g, '/').replace(/^\.\//, '')
  return !path || path === '..' || path.startsWith('../') || isAbsolute(path) ? undefined : path
}
/**
 * The file a Work session is about, read from its newest user messages. The desktop's resource registry lives in its
 * renderer, so this is the runtime-side record of the same choice; a session about the whole space has none.
 */
export async function workSessionAnchor(runtime: ServerRuntime, thread: Pick<ThreadRecord, 'id' | 'updatedAt'>, root: string) {
  let known = cache.get(runtime)
  if (!known) cache.set(runtime, known = new Map())
  const key = `${thread.id}:${thread.updatedAt}:${root}`, hit = known.get(key)
  if (hit !== undefined) return hit ?? undefined
  const load = runtime.sessionStore.loadItemPage
  let anchor: string | undefined
  if (load) {
    const page = await load.call(runtime.sessionStore, thread.id, { maxItems: SCAN_ITEMS, maxBytes: SCAN_BYTES }).catch(() => null)
    for (const item of [...(page?.items ?? [])].reverse()) {
      if (item.kind !== 'user_message') continue
      const locator = fromContexts(item.composerContexts) ?? fromText(item.text)
      anchor = locator ? spaceRelative(root, locator) : undefined
      if (anchor) break
    }
  }
  while (known.size >= CACHE) known.delete(known.keys().next().value!)
  known.set(key, anchor ?? null)
  return anchor
}
