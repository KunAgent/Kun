import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaperTurnContext } from '@shared/paper/paper-turn-context'
import { KunRuntimeProvider } from './kun-runtime'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => { rendererRuntimeClient.invalidateSettings(); vi.unstubAllGlobals() })

describe('paper runtime request', () => {
  it('forwards the exact frozen paper context to the selected runtime turn', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 202,
      body: JSON.stringify({ threadId: 'paper-thread', turnId: 'paper-turn' }) }))
    installDsGui({ runtimeRequest })
    const paperContext = createPaperTurnContext({ version: 1, scope: 'selected-passage', privacy: 'model-provider',
      purpose: 'Explain', providerId: 'api', model: 'model', maxModelRequests: 1,
      sources: [{ paperId: 'p1', title: 'Frozen', text: 'Exact evidence', sourceVersion: 'sha1' }] })
    await new KunRuntimeProvider().sendUserMessage('paper-thread', 'Question', { paperContext,
      providerId: 'api', model: 'model', agentSurface: 'write' })
    const call = runtimeRequest.mock.calls[0] as unknown as [string, string, string]
    expect(call[0]).toBe('/v1/threads/paper-thread/turns')
    expect(JSON.parse(call[2])).toMatchObject({ paperContext, providerId: 'api', model: 'model', prompt: 'Question' })
  })

})
