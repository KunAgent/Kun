import { afterEach, expect, test, vi } from 'vitest'
import type { AttachmentStore } from '../../attachments/attachment-store.js'
import { makeUserItem } from '../../domain/item.js'
import { AcpError } from './acp-schema.js'
import { AcpSessionManager } from './acp-session-manager.js'
import { makeHarness } from '../../../tests/helpers/acp-runtime-test-support.js'

afterEach(() => vi.restoreAllMocks())

test.each([true, false])('resumes after a failed preparation without losing requests or attachments (handoff=%s)', async (deterministicHandoff) => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const attachmentStore = {
    resolveContent: vi.fn(async (id: string) => id === 'image'
      ? { id, kind: 'image', mimeType: 'image/png', data: Buffer.from([1, 2, 3]) }
      : { id, kind: 'document', name: 'requirements.txt', mimeType: 'text/plain', documentText: 'PENDING_DOCUMENT_BODY' })
  } as unknown as AttachmentStore
  const h = await makeHarness('continuation-retry.json', { deps: { deterministicHandoff, attachmentStore } })
  expect(await h.runtime.runTurn('thread_1', 'turn_1', new AbortController().signal)).toBe('completed')
  const original = await h.coordinator.store.load('thread_1')
  const longRequest = `${'Preserve every requirement. '.repeat(700)}\nDo not delete the original data.`
  h.thread.turns.push({ ...h.thread.turns[0], id: 'turn_2' })
  h.items.push(makeUserItem({
    id: 'pending', threadId: 'thread_1', turnId: 'turn_2', text: longRequest,
    attachmentIds: ['document', 'image'],
    fileReferences: [{ path: `${h.workspace}/important.txt`, relativePath: 'important.txt', name: 'important.txt' }],
    reviewRequests: [{ workspaceId: 'workspace', requestId: 'rvq_12345678', title: 'Review', body: 'Never publish this change.' }]
  }))
  vi.spyOn(AcpSessionManager.prototype, 'ensureSession').mockRejectedValueOnce(new AcpError('request_timeout', 'temporary failure'))
  expect(await h.runtime.runTurn('thread_1', 'turn_2', new AbortController().signal)).toBe('failed')
  expect(await h.coordinator.store.load('thread_1')).toEqual(original)
  h.thread.turns.push({ ...h.thread.turns[0], id: 'turn_3' }, { ...h.thread.turns[0], id: 'turn_4' })
  h.items.push(
    makeUserItem({ id: 'retry', threadId: 'thread_1', turnId: 'turn_3', text: 'Retry with those constraints' }),
    makeUserItem({ id: 'future', threadId: 'thread_1', turnId: 'turn_4', text: 'FUTURE_QUEUED_REQUEST' })
  )
  const outcome = await h.runtime.runTurn('thread_1', 'turn_3', new AbortController().signal)
  expect(outcome, JSON.stringify(h.finished)).toBe('completed')
  const request = h.requests('session/prompt')[1]!.params!
  expect(request.sessionId).toBe(original!.nativeSessionId)
  const blocks = request.prompt as Array<Record<string, unknown>>
  const text = blocks.filter((block) => block.type === 'text').map((block) => String(block.text)).join('\n')
  expect(text).toContain(longRequest)
  expect(text).toContain('Never publish this change.')
  expect(text).toContain('PENDING_DOCUMENT_BODY')
  expect(text).not.toContain('FUTURE_QUEUED_REQUEST')
  expect(blocks).toContainEqual(expect.objectContaining({ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64') }))
  expect(blocks).toContainEqual(expect.objectContaining({ type: 'resource_link', name: 'important.txt' }))
  expect(h.requests('session/new')).toHaveLength(1)
  expect(h.recorded.some((event) => event.kind === 'handoff_injected')).toBe(false)
  expect(await h.coordinator.store.load('thread_1')).toMatchObject({ generation: 1, nativeSessionId: original!.nativeSessionId })
  expect(await h.runtime.runTurn('thread_1', 'turn_4', new AbortController().signal)).toBe('completed')
  const next = JSON.stringify(h.requests('session/prompt')[2]!.params)
  expect(next).toContain('FUTURE_QUEUED_REQUEST')
  expect(next).not.toContain('PENDING_DOCUMENT_BODY')
  expect(next).not.toContain('Do not delete the original data.')
})
