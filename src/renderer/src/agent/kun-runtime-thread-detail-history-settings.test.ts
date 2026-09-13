import { afterEach, describe, expect, it, vi } from 'vitest'
import { getKunThreadDetail } from './kun-runtime-thread-detail'
import { rendererRuntimeClient } from './runtime-client'
import { useCodexReferenceState } from '../history-reference/codex-reference-state'
import type { RuntimeRequestResult } from '@shared/kun-gui-api'

function response(turnId: string): RuntimeRequestResult {
  return { ok: true, status: 200, body: JSON.stringify({ id: 'thread', latestSeq: 4,
    turns: [{ id: turnId, status: 'completed', items: [{ kind: 'assistant_text',
      id: turnId, turnId, threadId: 'thread', text: turnId, createdAt: '2026-09-13T00:00:00Z' }] }],
    timeline: { hasMore: false }
  }) }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
afterEach(() => { vi.restoreAllMocks(); useCodexReferenceState.setState({ enabled: null, revision: 0 }) })

describe('timeline reads across history settings changes', () => {
  it('retries an old initial page after enabling, using a different request generation', async () => {
    useCodexReferenceState.setState({ enabled: false, revision: 1 })
    const first = deferred<RuntimeRequestResult>()
    const request = vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(response('codex:new'))
    const loading = getKunThreadDetail('thread')
    useCodexReferenceState.setState({ enabled: true, revision: 2 })
    first.resolve(response('stale'))
    const detail = await loading
    expect(detail.blocks.map((block) => block.id)).toEqual(['codex:new'])
    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[0]).toContain('historyRevision=1')
    expect(request.mock.calls[1]?.[0]).toContain('historyRevision=2')
  })
  it.each([{ before: 'old-cursor' }, { turnId: 'codex:old' }])('rejects old cursor/target requests: %j', async (options) => {
    useCodexReferenceState.setState({ enabled: true, revision: 1 })
    const old = deferred<RuntimeRequestResult>()
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockReturnValue(old.promise)
    const result = getKunThreadDetail('thread', options)
    useCodexReferenceState.setState({ enabled: false, revision: 2 })
    old.resolve(response('codex:old'))
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('does not expose a source response while disabled, even when the runtime is still updating', async () => {
    useCodexReferenceState.setState({ enabled: false, revision: 1 })
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue(response('codex:old'))
    expect((await getKunThreadDetail('thread')).blocks).toEqual([])
  })
})


describe('native runtime metadata for source history projections', () => {
  const sourceTurn = {
    id: 'codex:old', status: 'completed', createdAt: '2026-01-01T00:00:00Z',
    items: [{ kind: 'user_message', id: 'source-user', turnId: 'codex:old', threadId: 'thread',
      text: 'Old task', createdAt: '2026-01-01T00:00:00Z' }]
  }
  function stubResponse(metadata: Record<string, unknown> = {}): void {
    vi.spyOn(rendererRuntimeClient, 'runtimeRequest').mockResolvedValue({ ok: true, status: 200,
      body: JSON.stringify({ id: 'thread', status: 'idle', latestSeq: 0, turns: [sourceTurn],
        timeline: { hasMore: false }, ...metadata }) })
  }
  it('honors explicit null native metadata while still displaying Codex history', async () => {
    stubResponse({ latestTurn: null, activeTurn: null })
    const detail = await getKunThreadDetail('thread')
    expect(detail.blocks.map((block) => block.id)).toEqual(['source-user'])
    expect(detail).toMatchObject({ activeTurn: null, latestSeq: 0, threadStatus: 'idle' })
    expect(detail.latestTurnId).toBeUndefined()
    expect(detail.latestTurnStatus).toBeUndefined()
    expect(detail.latestTurnOrchestration).toBeUndefined()
    expect(detail.latestTurnStartedAtMs).toBeUndefined()
    expect(detail.latestUserMessageId).toBeUndefined()
  })
  it('never infers native metadata from a source-only legacy response', async () => {
    stubResponse({ turns: [{ ...sourceTurn, status: 'running' }] })
    const detail = await getKunThreadDetail('thread')
    expect(detail.blocks.map((block) => block.id)).toEqual(['source-user'])
    expect(detail.latestTurnId).toBeUndefined()
    expect(detail.latestTurnStatus).toBeUndefined()
    expect(detail.latestUserMessageId).toBeUndefined()
    expect(detail.liveProjection).toBeUndefined()
  })
  it('preserves explicit latest native metadata when an older page only contains source turns', async () => {
    stubResponse({ latestSeq: 42, latestTurn: { id: 'native-latest', status: 'completed', orchestration: 'direct' }, activeTurn: null })
    const detail = await getKunThreadDetail('thread', { before: 'source-cursor' })
    expect(detail.blocks.map((block) => block.id)).toEqual(['source-user'])
    expect(detail).toMatchObject({ latestSeq: 42, latestTurnId: 'native-latest', latestTurnStatus: 'completed', latestTurnOrchestration: 'direct' })
    expect(detail.latestUserMessageId).toBeUndefined()
  })
  it('still infers native metadata from native turns in legacy responses', async () => {
    stubResponse({ turns: [sourceTurn, { id: 'native', status: 'completed', items: [
      { kind: 'user_message', id: 'native-user', turnId: 'native', threadId: 'thread', text: 'Continue' }
    ] }] })
    const detail = await getKunThreadDetail('thread')
    expect(detail).toMatchObject({ latestTurnId: 'native', latestTurnStatus: 'completed', latestUserMessageId: 'native-user' })
  })
})
