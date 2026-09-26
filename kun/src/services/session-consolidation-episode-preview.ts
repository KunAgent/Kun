import { createHash } from 'node:crypto'
import type { ThreadRecord } from '../contracts/threads.js'
import type { ThreadStore } from '../ports/thread-store.js'
import { buildSessionTranscript } from '../loop/session-summary.js'

/**
 * Sample episode preview for a Phase 0 consolidation candidate. Reuses the
 * pure, no-LLM transcript builder already used for real session summaries;
 * never calls a model and never touches MemoryStore.
 */
export type ConsolidationEpisodePreview = {
  threadId: string
  transcriptExcerpt: string
  excerptBytes: number
  /** sha256 of `transcriptExcerpt`, mirroring MemoryRecord's excerpt+contentHash shape. */
  contentHash: string
}

export function buildCandidateEpisodePreview(thread: ThreadRecord, maxBytes: number): ConsolidationEpisodePreview {
  const items = thread.turns.flatMap((turn) => turn.items)
  const transcriptExcerpt = buildSessionTranscript(items, maxBytes)
  const excerptBytes = Buffer.byteLength(transcriptExcerpt, 'utf8')
  const contentHash = createHash('sha256').update(transcriptExcerpt, 'utf8').digest('hex')
  return { threadId: thread.id, transcriptExcerpt, excerptBytes, contentHash }
}

export async function previewCandidateEpisodes(
  threadIds: readonly string[],
  threadStore: Pick<ThreadStore, 'get' | 'getMetadata'>,
  maxBytes: number
): Promise<ConsolidationEpisodePreview[]> {
  const previews: ConsolidationEpisodePreview[] = []
  for (const threadId of threadIds) {
    const record = threadStore.getMetadata
      ? await threadStore.getMetadata(threadId).catch(() => null)
      : await threadStore.get(threadId).catch(() => null)
    if (record) previews.push(buildCandidateEpisodePreview(record, maxBytes))
  }
  return previews
}
