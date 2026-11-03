import { describe, expect, it } from 'vitest'
import { buildRouter } from './index.js'
import type { ServerRuntime } from './server-runtime.js'
import { HarnessCatalog } from '../../harness/harness-catalog.js'
import type { CursorCatalogEntry } from '../../harness/cursor-subscription-catalog.js'

const TOKEN = 'harness-token'
const authed = { authorization: `Bearer ${TOKEN}` }

async function dispatch(path: string, runtime: ServerRuntime): Promise<{ status: number; body: string }> {
  const router = buildRouter(runtime)
  const request = new Request(`http://127.0.0.1${path}`, { headers: authed })
  const match = router.match('GET', new URL(request.url).pathname)
  if (!match) throw new Error(`route not found: GET ${path}`)
  const result = await match.handler(request, { params: match.params })
  return result instanceof Response
    ? { status: result.status, body: await result.text() }
    : { status: result.status, body: result.body }
}

function runtime(cursorModels?: { list: () => Promise<CursorCatalogEntry[] | undefined> }): ServerRuntime {
  return {
    runtimeToken: TOKEN,
    insecure: false,
    nowIso: () => '2026-01-01T00:00:00.000Z',
    harnesses: { catalog: new HarnessCatalog(), ...(cursorModels ? { cursorModels } : {}) },
    modelConnections: { snapshot: async () => ({ providers: [
      { id: 'cursor-account', name: 'Cursor account', kind: 'cursor-sdk', authType: 'subscription',
        configured: true, credentialStatus: 'ready', models: ['grok-4.6'],
        modelCapabilities: { 'grok-4.6': { inputModalities: ['text', 'image'] } } }
    ] }) }
  } as unknown as ServerRuntime
}

describe('Cursor provider model catalog', () => {
  it('keeps the saved model when no account catalog is injected', async () => {
    const response = await dispatch('/v1/harnesses/cursor/models?credential_mode=provider', runtime())
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body).groups).toEqual([{
      providerId: 'cursor-account',
      label: 'Cursor account',
      models: ['grok-4.6'],
      modelInfo: [{ id: 'grok-4.6', inputModalities: ['text', 'image'] }]
    }])
  })

  it('replaces the saved id with the account catalog, names, efforts, and the saved vision mark', async () => {
    const listed: CursorCatalogEntry[] = [
      { id: 'composer-2.5', displayName: 'Composer 2.5', reasoningEfforts: [] },
      { id: 'grok-4.6', displayName: 'Grok 4.6', reasoningEfforts: ['high', 'max'], defaultReasoningEffort: 'high' }
    ]
    const response = await dispatch('/v1/harnesses/cursor/models?credential_mode=provider', runtime({
      list: async () => listed
    }))
    expect(JSON.parse(response.body).groups).toEqual([{
      providerId: 'cursor-account',
      label: 'Cursor account',
      models: ['composer-2.5', 'grok-4.6'],
      modelInfo: [
        { id: 'composer-2.5', displayName: 'Composer 2.5', reasoningEfforts: [] },
        { id: 'grok-4.6', displayName: 'Grok 4.6', reasoningEfforts: ['high', 'max'], defaultReasoningEffort: 'high', inputModalities: ['text', 'image'] }
      ]
    }])
  })

  it('falls back to the saved id when the account listing fails', async () => {
    const response = await dispatch('/v1/harnesses/cursor/models?credential_mode=provider', runtime({
      list: async () => { throw new Error('sdk unavailable') }
    }))
    expect(JSON.parse(response.body).groups[0].models).toEqual(['grok-4.6'])
  })
})
