import { expect, it } from 'vitest'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { registerCodeSyncRoutes } from './routes.js'
import type { HistorySyncFrame } from '@kun/remote-protocol'

async function fixture() {
  const f = await remoteFixture()
  registerCodeSyncRoutes(f.router, f.runtime, f.facade)
  const thread = await f.code()
  const queued = await f.h.turns.enqueueTurn({ threadId: thread.id, request: { prompt: 'test', clientSurface: 'api' } })
  await f.h.turns.startNextQueuedTurn(thread.id)
  const call = async (subscriptionId: string, options: { authorization?: string; syncKey?: string; device?: string; after?: unknown; authenticated?: boolean } = {}) => {
    const path = '/v1/remote/code-sync/' + thread.id
    const route = f.router.match('POST', path)!
    const request = new Request('http://runtime' + path, { method: 'POST', headers: {
      Authorization: options.authenticated === false ? 'Bearer wrong' : 'Bearer token', 'Content-Type': 'application/json',
      'X-Kun-Remote-Account': 'owner', 'X-Kun-Remote-Device': options.device ?? 'phone',
      'X-Kun-Remote-Authorization': options.authorization ?? 'transport_one',
      'X-Kun-Remote-Sync-Key': options.syncKey ?? 'grant_identity', 'X-Kun-Remote-Scopes': 'personal'
    }, body: JSON.stringify({ version: 2, subscriptionId, view: 'conversation', ...(options.after ? { after: options.after } : {}) }) })
    return await route.handler(request, { params: route.params }) as Response
  }
  return { ...f, thread, turnId: queued.turnId, call }
}
async function untilReady(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const frames: HistorySyncFrame[] = []
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) throw new Error('stream ended before ready')
    for (const block of new TextDecoder().decode(chunk.value).split('\n\n')) {
      if (!block.startsWith('data: ')) continue
      const frame = JSON.parse(block.slice(6)) as HistorySyncFrame
      frames.push(frame)
      if (frame.kind === 'reset') throw new Error(frame.reason)
      if (frame.kind === 'ready') return frames
    }
  }
}
it('uses verified Runtime auth and resumes the same grant across transport identities, isolating other grants', async () => {
  const f = await fixture()
  try {
    expect((await f.call('denied', { authenticated: false })).status).toBe(401)
    const first = await f.call('first'), reader = first.body!.getReader()
    const frames = await untilReady(reader)
    const snapshot = frames[0] as Extract<HistorySyncFrame, { kind: 'snapshot' }>
    expect(snapshot).toMatchObject({ kind: 'snapshot', data: { id: f.thread.id } })
    await reader.cancel()
    const reply = { id: 'reply', threadId: f.thread.id, turnId: f.turnId, role: 'assistant' as const, kind: 'assistant_text' as const,
      status: 'completed' as const, text: 'Visible without a history pull', createdAt: '2026-11-04T00:00:00Z' }
    await f.h.sessionStore.appendItem(f.thread.id, reply)
    await f.h.events.record({ kind: 'item_created', threadId: f.thread.id, turnId: f.turnId, itemId: 'reply', item: reply })
    const second = await f.call('second', { authorization: 'transport_two', after: { epoch: snapshot.epoch, seq: snapshot.seq } })
    const resumedReader = second.body!.getReader(), resumed = await untilReady(resumedReader)
    expect(resumed.map(frame => frame.kind)).toEqual(['patch', 'ready'])
    expect(JSON.stringify(resumed)).toContain('Visible without a history pull')
    await resumedReader.cancel()
    const different = await f.call('third', { syncKey: 'replacement_grant', after: { epoch: snapshot.epoch, seq: snapshot.seq } })
    const otherReader = different.body!.getReader(), other = await untilReady(otherReader)
    expect(other[0]).toMatchObject({ kind: 'snapshot' })
    expect((other[0] as { epoch: string }).epoch).not.toBe(snapshot.epoch)
    await otherReader.cancel()
  } finally { await f.close() }
})
