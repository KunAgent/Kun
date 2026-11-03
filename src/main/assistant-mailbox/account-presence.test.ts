import { describe, expect, it } from 'vitest'
import { loadAssistantPresence, parseAssistantPresence } from './account-presence'
const id = '12345678-1234-1234-1234-123456789012'
const p = { instanceId: id, platform: 'linux-x64', agentVersion: '0.7.0', capabilities: ['daemon'], syncState: 'online', listening: false,
  reportedAt: '2026-10-27T00:00:00Z', lastConsumerAt: null, lastError: null }
describe('account-scoped assistant presence', () => {
  it('does not confuse network connectivity and a consumer wait', () => {
    const value = { version: 2, userId: 'owner', assistants: [{ id, presence: p }] }
    expect(parseAssistantPresence(value, 'owner').get(id)).toMatchObject({ syncState: 'online', listening: false })
    expect(() => parseAssistantPresence(value, 'other')).toThrow('ASSISTANT_PRESENCE_INVALID')
    expect(() => parseAssistantPresence({ ...value, assistants: [{ id, presence: { ...p, listening: 'yes' } }] }, 'owner')).toThrow('ASSISTANT_PRESENCE_INVALID')
  })
  it('allows old servers only after 404 and does not downgrade authentication failures', async () => {
    const old = (async () => new Response('', { status: 404 })) as typeof fetch
    expect((await loadAssistantPresence('https://kun.test', 'owner', 'token', old)).size).toBe(0)
    const unauthorized = (async () => new Response('', { status: 401 })) as typeof fetch
    await expect(loadAssistantPresence('https://kun.test', 'owner', 'token', unauthorized)).rejects.toThrow('ASSISTANT_PRESENCE_UNAVAILABLE')
  })
})
