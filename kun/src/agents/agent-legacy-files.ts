import { readdir } from 'node:fs/promises'
import { z } from 'zod'
import type { RoomStore } from '../rooms/room-store.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { RoomContentReference } from '../contracts/room-content.js'

const Cursor = z.discriminatedUnion('phase', [
  z.object({ phase: z.literal('messages'), beforeSeq: z.number().int().nonnegative().optional(), offset: z.number().int().min(0).max(1000).default(0) }).strict(),
  z.object({ phase: z.literal('root'), after: z.string().max(4096).default('') }).strict()
])
const encode = (value: z.input<typeof Cursor>) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** Legacy paths are current workspace references, never reconstructed historic snapshots. */
export async function legacyAgentFiles(store: RoomStore, roomId: string, workspace: { id: string; path: string },
  cursor = 'start', search = '', limit = 30) {
  let input: z.infer<typeof Cursor>
  try { input = Cursor.parse(cursor === 'start' ? { phase: 'messages' } : JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))) }
  catch { throw new Error('invalid legacy file cursor') }
  const files: RoomContentReference[] = []
  const seen = new Set<string>()
  const matches = (file: Extract<RoomContentReference, { kind: 'agent_file' }>) =>
    (file.relativePath + ' ' + file.titleSnapshot).toLowerCase().includes(search.toLowerCase())
  if (input.phase === 'messages') {
    // Bound each request even when the search has no match in years of history.
    const rows = await store.list<RoomMessage>('message', { roomId, limit: 50, beforeSeq: input.beforeSeq })
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], references = row.value.references ?? []
      for (let offset = index === 0 ? input.offset : 0; offset < references.length; offset++) {
        const reference = references[offset]
        if (reference.kind !== 'agent_file' || reference.artifactId || reference.workspaceId !== workspace.id ||
          seen.has(reference.relativePath) || !matches(reference)) continue
        seen.add(reference.relativePath); files.push(reference)
        if (files.length === limit) return { files, nextLegacyCursor: encode({ phase: 'messages', beforeSeq: row.seq + 1, offset: offset + 1 }) }
      }
    }
    return { files, nextLegacyCursor: rows.length === 50
      ? encode({ phase: 'messages', beforeSeq: rows.at(-1)!.seq }) : encode({ phase: 'root' }) }
  }
  let entries
  try { entries = await readdir(workspace.path, { withFileTypes: true }) }
  catch { return { files } }
  const after = input.after
  const remaining = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name > after)
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  let last: string | undefined
  for (const entry of remaining) {
    const reference = { kind: 'agent_file' as const, workspaceId: workspace.id, relativePath: entry.name, titleSnapshot: entry.name }
    last = entry.name
    if (matches(reference)) files.push(reference)
    if (files.length === limit) break
  }
  return { files, ...(last && remaining.at(-1)?.name !== last ? { nextLegacyCursor: encode({ phase: 'root', after: last }) } : {}) }
}
