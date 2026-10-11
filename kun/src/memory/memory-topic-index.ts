import { createHash } from 'node:crypto'
import type { MemoryRecord } from '../contracts/memory.js'
import type { MemoryAccess } from './memory-store.js'
import { memoryInScope, memoryLifecycleState } from './memory-ranking.js'
import { canonicalMemoryHash } from './memory-record-normalizer.js'

export const MEMORY_TOPIC_INDEX_MAX_RECORDS = 256
export const MEMORY_TOPIC_INDEX_MAX_TOPICS = 24
export type MemoryTopicIndex = {
  version: 1
  canonicalDigest: string
  truncated: boolean
  topics: Array<{ id: string; label: string; memoryIds: string[]; total: number; latestAt: string }>
}

/** Rebuild only from current canonical records, after visibility and lifecycle gates. Never authoritative. */
export function buildMemoryTopicIndex(records: readonly MemoryRecord[], access: MemoryAccess = {}, nowMs = Date.now()): MemoryTopicIndex {
  const visible = records.filter((record) => memoryInScope(record, access) && memoryLifecycleState(record, nowMs) === 'active')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const selected = visible.slice(0, MEMORY_TOPIC_INDEX_MAX_RECORDS)
  const groups = new Map<string, MemoryRecord[]>()
  for (const record of selected) {
    const labels = record.tags.length ? record.tags.slice(0, 4) : [record.type]
    for (const label of new Set(labels.map((tag) => tag.normalize('NFKC').trim().toLowerCase().slice(0, 64)).filter(Boolean))) {
      groups.set(label, [...(groups.get(label) ?? []), record])
    }
  }
  const topics = [...groups].map(([label, members]) => ({
    id: 'topic_' + hash(label).slice(0, 20), label,
    memoryIds: members.slice(0, 8).map((record) => record.id), total: members.length,
    latestAt: members[0]!.updatedAt
  })).sort((a, b) => b.latestAt.localeCompare(a.latestAt) || a.label.localeCompare(b.label))
  return { version: 1, canonicalDigest: hash(selected.map((record) => [record.id, canonicalMemoryHash(record)])),
    truncated: visible.length > selected.length || topics.length > MEMORY_TOPIC_INDEX_MAX_TOPICS,
    topics: topics.slice(0, MEMORY_TOPIC_INDEX_MAX_TOPICS) }
}

/** Level two resolves IDs against fresh canonical data; stale/deleted/foreign entries cannot leak. */
export function readMemoryTopic(index: MemoryTopicIndex, topicId: string, canonical: readonly MemoryRecord[],
  access: MemoryAccess = {}, nowMs = Date.now()) {
  const fresh = buildMemoryTopicIndex(canonical, access, nowMs)
  const topic = fresh.topics.find((entry) => entry.id === topicId)
  const ids = new Set(topic?.memoryIds ?? [])
  return { indexChanged: fresh.canonicalDigest !== index.canonicalDigest, topic,
    memories: canonical.filter((record) => ids.has(record.id)).map((record) => ({
      id: record.id, type: record.type, summary: record.content.slice(0, 240), updatedAt: record.updatedAt,
      evidenceStatus: record.consolidation?.evidenceStatus ?? 'unverified',
      sourceCount: record.sources.length, sourceMemoryIds: record.consolidation?.sourceMemoryIds ?? []
    })) }
}
function hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
