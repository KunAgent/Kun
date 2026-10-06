import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import type { MemoryCreateRequest, MemoryRecord, MemorySourceEvidence } from '../contracts/memory.js'

const Barrier = z.object({
  memoryId: z.string(), scopeHash: z.string(), contentHashes: z.array(z.string()),
  operationId: z.string().optional(), sourceHashes: z.array(z.string()), at: z.string(), erased: z.boolean()
}).strict()
const Ledger = z.object({ version: z.literal(1), barriers: z.array(Barrier) }).strict()
export type MemoryForgettingLedger = z.infer<typeof Ledger>
type MemoryIdentity = Pick<MemoryCreateRequest, 'scope' | 'workspace' | 'project' | 'agentContext'> & { projectIdentity?: string }

export class MemoryForgottenError extends Error {
  constructor() { super('memory was forgotten; its content or source cannot be recaptured'); this.name = 'MemoryForgottenError' }
}
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const contentHash = (content: string): string => hash(content.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase())
function scopeHash(input: MemoryIdentity): string {
  const agent = input.agentContext
  if (!agent && input.scope === 'project' && input.projectIdentity) return hash(['project', input.projectIdentity])
  return hash(agent ? ['agent', agent.agentId, agent.sourceConversationId, agent.sourceTaskId, agent.sourceHandoffId]
    : [input.scope ?? 'workspace', input.workspace ?? '', input.project ?? ''])
}
function sourceHashes(sources: readonly Partial<MemorySourceEvidence>[]): string[] {
  return sources.flatMap((source) => {
    // A turn, message hash or memory-local source ID may cover several unrelated facts.
    // Only a specific evidence unit can carry a source-level recapture barrier.
    const anchors: unknown[][] = []
    const anchoredLocator = source.locator && /^(?:[A-Za-z][A-Za-z0-9+.-]*:|[/\\])/u.test(source.locator) ? source.locator : undefined
    if (source.itemId) anchors.push(['item', source.threadId, source.turnId, source.itemId])
    if (source.receiptId) anchors.push(['receipt', source.threadId, source.turnId, source.receiptId])
    if (anchoredLocator) anchors.push(['locator', anchoredLocator])
    const excerpt = source.excerpt?.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
    return anchors.map((anchor) => hash(['source-unit-v2', anchor,
      excerpt ? ['statement', excerpt] : ['whole-unit']]))
  })
}

export async function readMemoryForgetting(rootDir: string): Promise<MemoryForgettingLedger> {
  try { return Ledger.parse(JSON.parse(await readFile(join(rootDir, 'lifecycle', 'barriers.json'), 'utf8'))) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, barriers: [] }
    // A damaged barrier must fail closed, never silently revive forgotten knowledge.
    throw new Error('memory forgetting ledger is unavailable', { cause: error })
  }
}

export function memoryBlockedByForgetting(ledger: MemoryForgettingLedger,
  input: MemoryCreateRequest | MemoryRecord, id?: string): boolean {
  const scope = scopeHash(input)
  const content = contentHash(input.content)
  const sources = new Set(sourceHashes(input.sources ?? []))
  const derived = new Set(input.consolidation?.sourceMemoryIds ?? [])
  if (input.supersedes) derived.add(input.supersedes)
  return ledger.barriers.some((barrier) => barrier.memoryId === id || derived.has(barrier.memoryId) ||
    barrier.scopeHash === scope && barrier.contentHashes.includes(content) ||
    barrier.sourceHashes.some((source) => sources.has(source)))
}

export async function assertMemoryNotForgotten(rootDir: string,
  input: MemoryCreateRequest | MemoryRecord, id?: string): Promise<void> {
  if (memoryBlockedByForgetting(await readMemoryForgetting(rootDir), input, id)) throw new MemoryForgottenError()
}

/** A barrier commits before content removal, making interrupted erasure fail closed. */
export async function recordMemoryForgetting(rootDir: string, records: readonly MemoryRecord[],
  erased: boolean, at: string, operationId?: string): Promise<void> {
  const ledger = await readMemoryForgetting(rootDir)
  for (const record of records) {
    const previous = ledger.barriers.find((item) => item.memoryId === record.id)
    const entry = Barrier.parse({
      memoryId: record.id, scopeHash: scopeHash(record), at, operationId: operationId ?? previous?.operationId,
      erased: erased || previous?.erased === true,
      contentHashes: [...new Set([...(previous?.contentHashes ?? []), contentHash(record.content),
        ...record.history.map((item) => contentHash(item.snapshot.content)),
        ...(record.correctedFrom ? [contentHash(record.correctedFrom)] : [])])],
      sourceHashes: [...new Set([...(previous?.sourceHashes ?? []), ...sourceHashes(record.sources),
        ...record.history.flatMap((item) => sourceHashes(item.snapshot.sources))])]
    })
    ledger.barriers = [...ledger.barriers.filter((item) => item.memoryId !== record.id), entry]
  }
  await atomicWriteFile(join(rootDir, 'lifecycle', 'barriers.json'), JSON.stringify(ledger))
}

export function applyMemoryForgetting(ledger: MemoryForgettingLedger, record: MemoryRecord): MemoryRecord | undefined {
  const barrier = ledger.barriers.find((item) => item.memoryId === record.id)
  if (barrier?.erased) return undefined
  if (barrier) return { ...record, deletedAt: record.deletedAt ?? barrier.at }
  // The forgetting mutation explicitly marks its target and known descendants. A source
  // collision must not retroactively hide an unrelated, already saved sibling record.
  // Fresh writes still pass memoryBlockedByForgetting under the canonical mutation lock.
  const derived = new Set(record.consolidation?.sourceMemoryIds ?? [])
  if (record.supersedes) derived.add(record.supersedes)
  if (ledger.barriers.some((entry) => derived.has(entry.memoryId))) return undefined
  return record
}

export function memoryDescendants(records: readonly MemoryRecord[], id: string): MemoryRecord[] {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const record of records) {
      if (ids.has(record.id)) continue
      if (record.supersedes && ids.has(record.supersedes) ||
        record.consolidation?.sourceMemoryIds.some((source) => ids.has(source))) {
        ids.add(record.id); changed = true
      }
    }
  }
  return records.filter((record) => ids.has(record.id))
}
