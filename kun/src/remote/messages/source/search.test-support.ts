import { join } from 'node:path'
import { HistoryReferenceService } from '../../../history/history-reference-service.js'
import type { HistorySourceProvider } from '../../../contracts/history-reference.js'
import type { TurnItem } from '../../../contracts/items.js'
import { remoteFixture } from '../../testing/runtime.test-support.js'
import { longSource } from './content.test-support.js'
export async function sourceSearchFixture(provider: HistorySourceProvider = 'codex', body?: string) {
  const f = await remoteFixture()
  let enabled = true
  f.runtime.historyReferences = new HistoryReferenceService({ dataDir: join(f.root, 'source-data'), threadService: f.h.threads,
    threadStore: f.h.threadStore, enabled: () => enabled, enabledFor: () => enabled, defaultModel: () => ({ model: 'fake' }) })
  const source = await longSource(f.root, f.runtime.historyReferences, provider, 'search', undefined, body)
  const resource = { kind: 'code' as const, id: source.thread.id }
  const append = async (text: string, id = 'native_match') => f.h.sessionStore.appendItem(source.thread.id, { id, threadId: source.thread.id,
    turnId: 'native_turn', kind: 'assistant_text', role: 'assistant', status: 'completed', text, createdAt: new Date().toISOString() } as TurnItem)
  const search = (query: string, cursor?: string, limit = 1) => f.call('message.search', { resource, query, limit, ...(cursor ? { cursor } : {}) })
  return { ...f, source, resource, append, search, disable: () => { enabled = false } }
}
