import { LOCAL_GMAIL_RECIPIENT } from '../../contracts/gmail.js'
import { describe, expect, it, vi } from 'vitest'
import { InMemoryThreadStore } from '../../adapters/in-memory-thread-store.js'
import { createThreadRecord } from '../../domain/thread.js'
import type { GmailServicePort } from '../../gmail/ports.js'
import { GMAIL_SCOPES } from '../../gmail/ports.js'
import { Router } from '../router.js'
import type { JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { registerGmailRoutes } from './gmail.js'

const authId = '643aeb6b-049d-430d-a362-46d74e8c6447'
function fixture() {
  const threads = new Map<string, unknown>([['thread-1', { id: 'thread-1', model: 'test-model', providerId: 'test-provider', turns: [] }]])
  const status = { configured: true, connected: true, reconnectRequired: false,
    scopes: [...GMAIL_SCOPES], allowModelSharing: false, email: 'owner@example.com' }
  const gmail = { status: vi.fn(async () => status), hasGoogleData: vi.fn(async () => false), markGoogleData: vi.fn(async () => {}),
    startAuthorize: vi.fn(async () => ({ id: authId, url: 'https://accounts.google.com/o/oauth2/v2/auth', status: 'pending' })),
    pollAuthorization: vi.fn(async () => ({ id: authId, status: 'connected' })),
    cancelAuthorization: vi.fn(async () => ({ id: authId, status: 'cancelled' })),
    setModelSharing: vi.fn(async () => status), disconnect: vi.fn(async () => {}) } as unknown as GmailServicePort
  const rows = new Map<string, { id: string; roomId: string; revision: number; value: Record<string, unknown> }>([
    ['message-1', { id: 'message-1', roomId: 'room-1', revision: 0, value: {
      presentationKind: 'app_connection', appConnection: { serverId: 'google_gmail', status: 'requested', resumed: false },
      originRunId: 'run-1', authorKind: 'member', authorMemberId: 'member-1'
    } }],
    ['run-1', { id: 'run-1', roomId: 'room-1', revision: 0, value: {
      phase: 'conversation', memberId: 'member-1', participantAgentId: 'agent-1', threadId: 'room-thread', turnId: 'turn-1'
    } }]
  ])
  threads.set('room-thread', { id: 'room-thread', model: 'model', turns: [{ id: 'turn-1', model: 'source-model', providerId: 'source-provider' }], roomContext: { kind: 'conversation',
    roomId: 'room-1', memberId: 'member-1', participantAgentId: 'agent-1', blockedProviderIds: [] } })
  const room = { id: 'room-1', conversationKind: 'user_agent', members: [{ id: 'member-1', enabled: true,
    participantAgentId: 'agent-1' }] }
  const policy = { availability: vi.fn(async () => ({ allowed: true, recipient: 'kun-managed-local' as const, recipientBinding: LOCAL_GMAIL_RECIPIENT, consentId: 'local-proof' })), assertAllowed: vi.fn(async () => {}) }
  const localStatus = { installed: true, running: true, ready: false, preparing: false, model: 'qwen3:4b' }
  const localModel = { status: vi.fn(() => localStatus), prepare: vi.fn(() => ({ ...localStatus, preparing: true })) }
  const runtime = { runtimeToken: 'test-token', insecure: true, gmail, gmailDataPolicy: policy, gmailLocalModel: localModel,
    threadService: { get: vi.fn(async (id: string) => threads.get(id) ?? null) }, rooms: {
      service: { get: vi.fn(async () => room) }, deps: { store: { get: vi.fn(async (_kind: string, id: string) => rows.get(id)), list: vi.fn(async () => []) } }
    } } as unknown as ServerRuntime
  const router = new Router()
  registerGmailRoutes(router, runtime)
  const request = async (method: string, path: string, body?: unknown, authorized = true) => {
    const route = router.match(method, new URL(path, 'http://local.test').pathname)!
    if (!route) throw new Error('route not registered')
    return await route.handler(new Request(`http://local.test${path}`, { method,
      headers: { ...(authorized ? { authorization: 'Bearer test-token' } : {}), 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }), { params: route.params }) as JsonResponse
  }
  return { runtime, gmail, policy, localModel, router, threads, room, rows, status, request }
}

describe('native Gmail authenticated host routes', () => {
  it('requires the runtime token even in insecure mode and exposes only bounded public status', async () => {
    const f = fixture()
    expect((await f.request('GET', '/v1/gmail/status?threadId=thread-1', undefined, false)).status).toBe(401)
    expect(f.gmail.status).not.toHaveBeenCalled()
    const result = await f.request('GET', '/v1/gmail/status?threadId=thread-1')
    expect(result.status).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(result.body)).toMatchObject({ connected: true, allowModelSharing: false, modelProviderName: 'test-provider' })
    expect(JSON.parse(result.body)).toMatchObject({ modelSharingAvailable: true })
    expect(f.gmail.status).toHaveBeenCalledWith('thread:thread-1', LOCAL_GMAIL_RECIPIENT)
    expect(f.router.match('POST', '/v1/gmail/send')).toBeUndefined()
  })

  it('binds authorization, polling and cancellation to an existing host thread and defaults consent off', async () => {
    const f = fixture()
    expect((await f.request('POST', '/v1/gmail/authorize', { threadId: 'thread-1' })).status).toBe(200)
    expect(f.gmail.startAuthorize).toHaveBeenCalledWith({ scopeId: 'thread:thread-1', allowModelSharing: false, recipient: undefined })
    expect((await f.request('GET', `/v1/gmail/authorization/${authId}?threadId=thread-1`)).status).toBe(200)
    expect(f.gmail.pollAuthorization).toHaveBeenCalledWith(authId, 'thread:thread-1')
    expect((await f.request('DELETE', `/v1/gmail/authorization/${authId}?threadId=thread-1`)).status).toBe(200)
    expect(f.gmail.cancelAuthorization).toHaveBeenCalledWith(authId, 'thread:thread-1')
    expect((await f.request('POST', '/v1/gmail/authorize', { threadId: 'absent', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).toBe(404)
    expect(f.gmail.startAuthorize).toHaveBeenCalledTimes(1)
  })

  it('rejects arbitrary scope IDs, callback URLs, mixed bindings and rooms masquerading as Code threads', async () => {
    const f = fixture()
    for (const input of [{ scopeId: 'thread:thread-1' }, { threadId: 'thread-1', callbackUrl: 'https://attacker.test' },
      { threadId: 'thread-1', roomId: 'room-1', messageId: 'message-1' }, { roomId: 'room-1' }]) {
      expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(400)
    }
    expect((await f.request('POST', '/v1/gmail/authorize', { threadId: 'room-thread' })).status).toBe(404)
    expect(f.gmail.startAuthorize).not.toHaveBeenCalled()
  })

  it('grants and revokes model sharing only for the current persisted conversation', async () => {
    const f = fixture()
    expect((await f.request('PATCH', '/v1/gmail/sharing', { threadId: 'thread-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).toBe(200)
    expect(f.gmail.setModelSharing).toHaveBeenCalledWith('thread:thread-1', true, LOCAL_GMAIL_RECIPIENT)
    expect((await f.request('PATCH', '/v1/gmail/sharing', { roomId: 'room-1', messageId: 'message-1', allowModelSharing: false })).status).toBe(200)
    expect(f.gmail.setModelSharing).toHaveBeenCalledWith('room:room-1', false, undefined)
    expect((await f.request('DELETE', '/v1/gmail/connection', { threadId: 'thread-1' })).status).toBe(200)
    expect(f.gmail.disconnect).toHaveBeenCalledWith({ revoke: true })
  })

  it('checks the card, run, member and thread identity before opening Google or changing grants', async () => {
    const f = fixture()
    const input = { roomId: 'room-1', messageId: 'message-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' }
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(200)
    expect(f.gmail.startAuthorize).toHaveBeenCalledWith({ scopeId: 'room:room-1', allowModelSharing: true, recipient: LOCAL_GMAIL_RECIPIENT })
    f.room.members[0].enabled = false
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(404)
    f.room.members[0].enabled = true
    f.room.members[0].participantAgentId = 'other-agent'
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(404)
    expect(f.gmail.startAuthorize).toHaveBeenCalledTimes(1)
  })

  it('rejects blocked, skipped, archived and non-private card scopes', async () => {
    const f = fixture(), input = { roomId: 'room-1', messageId: 'message-1' }
    const thread = f.threads.get('room-thread') as { roomContext: { blockedProviderIds: string[] } }
    thread.roomContext.blockedProviderIds.push('gmail')
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(404)
    thread.roomContext.blockedProviderIds = []
    ;(f.rows.get('message-1')!.value.appConnection as { status: string }).status = 'skipped'
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(404)
    ;(f.rows.get('message-1')!.value.appConnection as { status: string }).status = 'requested'
    f.room.conversationKind = 'group'
    expect((await f.request('POST', '/v1/gmail/authorize', input)).status).toBe(404)
    expect(f.gmail.startAuthorize).not.toHaveBeenCalled()
  })

  it('denies Google data grants for an unsupported admitted model route while allowing revocation', async () => {
    const f = fixture()
    f.policy.assertAllowed.mockRejectedValue(new Error('unsupported'))
    expect((await f.request('POST', '/v1/gmail/authorize', { threadId: 'thread-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).not.toBe(200)
    expect((await f.request('PATCH', '/v1/gmail/sharing', { threadId: 'thread-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).not.toBe(200)
    expect(f.gmail.startAuthorize).not.toHaveBeenCalled()
    expect(f.gmail.setModelSharing).not.toHaveBeenCalled()
    expect((await f.request('PATCH', '/v1/gmail/sharing', { threadId: 'thread-1', allowModelSharing: false })).status).toBe(200)
  })

  it('prepares only the host-owned fixed local model with authenticated conversation binding', async () => {
    const f = fixture()
    expect((await f.request('GET', '/v1/gmail/local-model?threadId=thread-1')).status).toBe(200)
    expect((await f.request('POST', '/v1/gmail/local-model', { threadId: 'thread-1' })).status).toBe(200)
    expect(f.localModel.prepare).toHaveBeenCalledOnce()
    expect((await f.request('POST', '/v1/gmail/local-model', { threadId: 'thread-1', model: 'cloud-model' })).status).toBe(400)
    expect((await f.request('POST', '/v1/gmail/local-model', { threadId: 'missing' })).status).toBe(404)
    expect((await f.request('POST', '/v1/gmail/local-model', { threadId: 'thread-1' }, false)).status).toBe(401)
    expect(f.localModel.prepare).toHaveBeenCalledOnce()
  })

  it('cannot grant Gmail access to an IM-mirrored Room or messaging thread', async () => {
    const f = fixture()
    f.runtime.rooms!.deps.store.list = vi.fn(async () => [{ value: { enabled: true } }]) as never
    expect((await f.request('POST', '/v1/gmail/authorize', { roomId: 'room-1', messageId: 'message-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).toBe(409)
    const thread = f.threads.get('thread-1') as { turns: unknown[] }
    thread.turns.push({ id: 'im-turn', clientSurface: 'im', imContext: true })
    expect((await f.request('POST', '/v1/gmail/authorize', { threadId: 'thread-1', allowModelSharing: true, expectedRecipient: 'kun-managed-local', expectedConsentId: 'local-proof' })).status).toBe(409)
    expect(f.gmail.startAuthorize).not.toHaveBeenCalled()
  })
  it('rejects stale or missing recipient disclosure without creating a grant', async () => {
    const f = await fixture()
    for (const consent of [{}, { expectedRecipient: 'deepseek-api', expectedConsentId: 'local-proof' },
      { expectedRecipient: 'kun-managed-local', expectedConsentId: 'stale' }]) {
      const response = await f.request('PATCH', '/v1/gmail/sharing', { threadId: 'thread-1', allowModelSharing: true, ...consent })
      expect(response.status).toBe(409)
      expect(JSON.parse(response.body).code).toBe('model_consent_changed')
    }
    expect(f.gmail.setModelSharing).not.toHaveBeenCalled()
  })

})
