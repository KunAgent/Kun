import { describe, expect, it } from 'vitest'
import type { TurnItem } from '../contracts/items.js'
import { TrajectoryDetailSchema, type TrajectoryMessageRecord } from '../contracts/trajectory.js'
import type { SessionStore } from '../ports/session-store.js'
import { LlmDebugRecorder } from './llm-debug-recorder.js'
import { projectMessageRawDetail, projectMessageRenderedDetail } from './trajectory-query-message-detail.js'
import { TrajectoryQueryService } from './trajectory-query-service.js'

const base = {
  threadId: 'thread', turnId: 'turn', role: 'assistant' as const,
  status: 'completed' as const, createdAt: '2026-01-01T00:00:00.000Z'
}
const record: TrajectoryMessageRecord = {
  schemaVersion: 2, id: 'assistant', kind: 'assistant', ...base,
  roundId: 'round', step: 0, startedAt: base.createdAt, preview: '',
  detailState: 'available', itemId: 'one', itemIds: ['one', 'two'],
  thinkingPreview: '', attachmentIds: []
}

describe('trajectory reply render policy', () => {
  it.each(['safe-markdown', 'plain-text'] as const)('retains %s through detail projection and schema', (renderMode) => {
    const items: TurnItem[] = [{ ...base, id: 'one', kind: 'assistant_text', text: '# Answer', renderMode }]
    const projected = projectMessageRenderedDetail(record, items)
    expect(projected).toMatchObject({ content: '# Answer', renderMode })
    expect(TrajectoryDetailSchema.parse({
      schemaVersion: 2, recordId: record.id, section: 'rendered', ...projected
    }).renderMode).toBe(renderMode)
    const raw = projectMessageRawDetail(record, items, [])
    expect(raw).not.toHaveProperty('renderMode')
    expect(raw.content).toMatchObject({ blocks: [{ type: 'text', content: '# Answer' }] })
  })

  it('takes the strictest selected policy without leaking other replies into the preview', () => {
    const items: TurnItem[] = [
      { ...base, id: 'one', kind: 'assistant_reasoning', text: '**Literal**', renderMode: 'plain-text' },
      { ...base, id: 'two', kind: 'assistant_text', text: '# Answer', renderMode: 'safe-markdown' },
      { ...base, id: 'unselected', kind: 'assistant_text', text: 'Other' }
    ]
    expect(projectMessageRenderedDetail(record, items)).toMatchObject({
      renderMode: 'plain-text', content: '**Literal**\n\n# Answer'
    })
    items[0] = { ...base, id: 'one', kind: 'assistant_reasoning', text: 'Thinking' }
    expect(projectMessageRenderedDetail(record, items).renderMode).toBe('safe-markdown')
    expect(projectMessageRenderedDetail({ ...record, itemId: 'unselected', itemIds: [] }, items))
      .not.toHaveProperty('renderMode')
  })

  it('retains safe-markdown after service lookup and content truncation', async () => {
    const items: TurnItem[] = [{
      ...base, id: 'one', kind: 'assistant_text', text: '# Answer\n'.repeat(4_000), renderMode: 'safe-markdown'
    }]
    const sessions = { loadItems: async () => items } as unknown as SessionStore
    const service = new TrajectoryQueryService(new LlmDebugRecorder(), sessions)
    const page = await service.page('thread', { limit: 20, filter: 'all', query: '' })
    const assistant = page.records.find((entry) => entry.kind === 'assistant')!
    const detail = await service.detail('thread', assistant.id, 'rendered')
    expect(detail).toMatchObject({ state: 'truncated', truncated: true, renderMode: 'safe-markdown' })
    expect(Buffer.byteLength(detail!.content as string, 'utf8')).toBeLessThanOrEqual(16_384)
  })
})
