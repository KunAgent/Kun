import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { artifactHash } from './artifact-bundle.js'
import { mergeArtifactSources, type ArtifactToolItem } from './artifact-sources.js'

/** Bounded, anchored history windows preserve multi-call designs without loading an entire session. */
export async function artifactSourceWindow(
  runtime: ServerRuntime,
  threadId: string,
  before: string | undefined,
  anchor: string | undefined,
  complete: (item: ArtifactToolItem) => Promise<ArtifactToolItem>
) {
  const load = runtime.sessionStore.loadItemPage
  if (!load) throw new Error('UNSUPPORTED_OPERATION')
  const retained: ArtifactToolItem[] = []
  let cursor = before, head = anchor, foundAnchor = !anchor, hasMore = false, bytes = 0
  let last: string | undefined
  for (let pageNumber = 0; pageNumber < 32 && retained.length < 2048; pageNumber++) {
    const page = await load.call(runtime.sessionStore, threadId, { before: cursor, maxItems: 128, maxBytes: 512 * 1024 })
    if (!page.items.length) { hasMore = false; break }
    if (page.items.at(-1)?.id === cursor) throw new Error('HISTORY_CHANGED')
    if (!head) head = page.items.at(-1)!.id
    for (const raw of [...page.items].reverse()) {
      if (!foundAnchor) {
        if (raw.id !== anchor) continue
        foundAnchor = true
      }
      const item = raw.kind === 'tool_result'
        ? await complete(raw as ArtifactToolItem).catch(() => raw as ArtifactToolItem)
        : raw.kind === 'tool_call' ? raw as ArtifactToolItem
          : { id: raw.id, kind: raw.kind, turnId: raw.turnId } as ArtifactToolItem
      const size = Buffer.byteLength(JSON.stringify(item), 'utf8')
      if (retained.length && (bytes + size > 8 * 1024 * 1024 || retained.length >= 2048)) {
        hasMore = true
        break
      }
      retained.push(item)
      bytes += size
      last = raw.id
    }
    if (hasMore) break
    hasMore = page.hasMore
    if (!hasMore) break
    const next = page.nextCursor ?? page.items[0]!.id
    if (next === cursor) throw new Error('HISTORY_CHANGED')
    cursor = next
    hasMore = false
    if (pageNumber === 31 || retained.length >= 2048) hasMore = true
  }
  if (!foundAnchor) throw new Error('HISTORY_CHANGED')
  const chronological = retained.reverse()
  const ordinal = new Map(chronological.map((item, index) => [item.id, index]))
  const sources = mergeArtifactSources(chronological)
    .sort((left, right) => (ordinal.get(right.itemId) ?? 0) - (ordinal.get(left.itemId) ?? 0))
  return { sources, before: last, anchor: head, hasMore,
    signature: artifactHash(JSON.stringify(sources.map(source => [source.key, source.itemId]))) }
}
