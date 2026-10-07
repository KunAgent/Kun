import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { FileThreadStore } from '../adapters/file/file-thread-store.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { makeAssistantTextItem } from '../domain/item.js'
import { createPaperTurnContext } from './paper-turn-context.js'

it('rehydrates exact scope, versions, digest, consumed budget and passive Markdown policy from disk', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-paper-policy-'))
  try {
    const context = createPaperTurnContext({ version: 1, scope: 'multi-paper', privacy: 'model-provider',
      purpose: 'Compare the evidence', providerId: 'api', model: 'fixed-model', maxModelRequests: 1,
      sources: [{ paperId: 'p1', title: 'One', sourceVersion: 'sha1', text: 'Exact first text' },
        { paperId: 'p2', title: 'Two', sourceVersion: 'sha2', text: 'Exact second text' }] })
    const turn = createTurnRecord({ id: 'turn-paper', threadId: 'thread-paper', prompt: 'Compare', paperContext: context })
    turn.paperModelRequests = 1
    const answer = 'Partial answer ![not fetched](https://untrusted.test)'
    turn.items = [makeAssistantTextItem({ id: 'answer', threadId: 'thread-paper', turnId: turn.id,
      text: answer, renderMode: 'safe-markdown' })]
    const store = new FileThreadStore({ dataDir })
    await store.upsert({ ...createThreadRecord({ id: 'thread-paper', title: 'Paper', workspace: dataDir, model: 'fixed-model' }), turns: [turn] })
    const recovered = await new FileThreadStore({ dataDir }).get('thread-paper')
    expect(recovered?.turns[0]).toMatchObject({ paperContext: context,
      paperContextSha256: turn.paperContextSha256, paperModelRequests: 1,
      sandboxMode: 'read-only', items: [expect.objectContaining({ renderMode: 'safe-markdown', text: answer })] })
  } finally { await rm(dataDir, { recursive: true, force: true }) }
})
