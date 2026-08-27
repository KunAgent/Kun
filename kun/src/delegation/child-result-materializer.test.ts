import { describe, expect, it } from 'vitest'
import { InMemoryArtifactStore, type ArtifactStore } from '../artifacts/artifact-store.js'
import { makeAssistantTextItem, makeToolResultItem } from '../domain/item.js'
import {
  CHILD_RESULT_MAX_BYTES,
  CHILD_RESULT_PREVIEW_CHARS,
  childResultSource,
  materializeChildResult
} from './child-result-materializer.js'

describe('child result materialization', () => {
  it('selects only the final non-empty assistant answer', () => {
    const items = [
      makeAssistantTextItem({
        id: 'one', threadId: 'child', turnId: 'turn', text: 'large draft', status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'blank', threadId: 'child', turnId: 'turn', text: '   ', status: 'completed'
      }),
      makeAssistantTextItem({
        id: 'final', threadId: 'child', turnId: 'turn', text: 'final answer', status: 'completed'
      })
    ]
    expect(childResultSource(items, 'turn', 'completed')).toBe('final answer')
  })

  it('bounds the tool_result fallback preview when the child wrote no text', () => {
    const oversized = 'x'.repeat(600_000)
    const items = [makeToolResultItem({
      id: 'result', threadId: 'child', turnId: 'turn', callId: 'call',
      toolName: 'grep', output: { status: 'completed', childId: 'child_x', payload: oversized }
    })]
    const summary = childResultSource(items, 'turn', 'completed')
    expect(summary.length).toBeLessThanOrEqual(CHILD_RESULT_PREVIEW_CHARS)
    expect(summary.endsWith('…')).toBe(true)
    expect(summary.startsWith('{"status":"completed"')).toBe(true)
  })

  it('uses the placeholder when the tool_result output stringifies to empty', () => {
    const items = [makeToolResultItem({
      id: 'result', threadId: 'child', turnId: 'turn', callId: 'call',
      toolName: 'grep', output: ''
    })]
    expect(childResultSource(items, 'turn', 'completed'))
      .toBe('Child agent completed without a text response.')
  })

  it('keeps a small answer inline', async () => {
    await expect(materializeChildResult({
      content: 'small answer',
      childId: 'child',
      parentThreadId: 'parent',
      artifactStore: new InMemoryArtifactStore()
    })).resolves.toEqual({ summary: 'small answer' })
  })

  it('externalizes results crossing byte, line, or CJK token limits', async () => {
    for (const content of [
      'x'.repeat(CHILD_RESULT_MAX_BYTES + 1),
      Array.from({ length: 2_001 }, () => 'x').join('\n'),
      '汉'.repeat(8_001)
    ]) {
      const store = new InMemoryArtifactStore()
      const result = await materializeChildResult({
        content,
        childId: 'child',
        parentThreadId: 'parent',
        artifactStore: store
      })
      expect(result.summary.length).toBeLessThanOrEqual(CHILD_RESULT_PREVIEW_CHARS)
      expect(result.summaryTruncated).toBe(true)
      expect(result.resultRef).toMatchObject({ mimeType: 'text/markdown' })
      expect(await store.get(result.resultRef!.artifactId)).toBe(content)
      expect(await store.stat(result.resultRef!.artifactId)).toMatchObject({
        retention: 'linked',
        linkedOwners: ['thread:parent', 'child:child']
      })
    }
  })

  it('never falls back to raw oversized output when artifact persistence fails', async () => {
    const content = 'secret'.repeat(10_000)
    const failingStore: ArtifactStore = {
      put: async () => { throw new Error('quota exceeded at /private/path') },
      get: async () => null,
      readRange: async () => null,
      stat: async () => null
    }
    const result = await materializeChildResult({
      content,
      childId: 'child',
      parentThreadId: 'parent',
      artifactStore: failingStore
    })
    expect(result.summary.length).toBeLessThanOrEqual(CHILD_RESULT_PREVIEW_CHARS)
    expect(result.summary).not.toBe(content)
    expect(result.resultRef).toBeUndefined()
    expect(result.resultUnavailableReason).not.toContain('/private/path')
  })

  it('keeps a multi-megabyte child result out of the parent-facing projection', async () => {
    const content = 'x'.repeat(4 * 1_024 * 1_024)
    const store = new InMemoryArtifactStore()
    const result = await materializeChildResult({
      content,
      childId: 'large-child',
      parentThreadId: 'unrelated-parent',
      artifactStore: store
    })
    expect(result.summary.length).toBeLessThanOrEqual(CHILD_RESULT_PREVIEW_CHARS)
    expect(result.resultRef?.byteSize).toBe(Buffer.byteLength(content, 'utf8'))
    expect(await store.get(result.resultRef!.artifactId)).toHaveLength(content.length)
  })
})
