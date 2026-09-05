import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseExtensionManifest } from '@kun/extension-api'
import {
  ExtensionPaths,
  ExtensionRegistry,
  manifestCompatibilityReport,
  type DevelopmentExtensionRecord
} from '../../src/extensions/index.js'
import { ExtensionViewSessionService } from '../../src/services/extension-view-session-service.js'
import { extensionProviderId } from '../../src/services/extension-provider-account-store.js'
import type { ExtensionAgentEvent } from '../../src/services/extension-agent-service.js'
import type { ServerRuntime } from '../../src/server/routes/server-runtime.js'
import {
  buildExtensionPublicRouter,
  EXTENSION_SESSION_ID_HEADER,
  EXTENSION_SESSION_NONCE_HEADER
} from '../../src/server/routes/extension-public.js'
import {
  WORKSPACE_ROOT,
  createFixture,
  createSession,
  dispatchJson,
  dispatchRaw,
  runtimeHeaders,
  sessionHeaders
} from './extension-public-fixture.js'

describe('extension public routes', () => {
  it('rejects guest identity fields and Agent calls without a bound session', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const unauthenticated = await dispatchJson(router, 'POST', '/v1/extensions/agent/runs', { input: 'hello' })
    expect(unauthenticated.status).toBe(401)

    const created = await createSession(router)
    const forged = await dispatchJson(router, 'POST', '/v1/extensions/agent/runs', {
      input: 'hello',
      ownerExtensionId: 'other.extension'
    }, sessionHeaders(created.body.sessionId, created.body.nonce))
    expect(forged.status).toBe(400)
    expect(fixture.agent.createRun).not.toHaveBeenCalled()
  })

  it('keeps private goal-context events out of agent polling while advancing its cursor', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const session = await createSession(router)
    const hidden: ExtensionAgentEvent = {
      seq: 7,
      timestamp: '2026-07-11T08:00:00.000Z',
      type: 'item_created',
      runId: 'run_goal',
      threadId: 'thread_goal',
      ownerExtensionId: 'acme.dashboard',
      payload: {
        item: { kind: 'goal_context', text: 'Internal goal text must not reach an extension' }
      }
    }
    const publicEvent: ExtensionAgentEvent = {
      seq: 8,
      timestamp: '2026-07-11T08:00:01.000Z',
      type: 'assistant_text_delta',
      runId: 'run_goal',
      threadId: 'thread_goal',
      ownerExtensionId: 'acme.dashboard',
      payload: {
        role: 'assistant',
        messageId: 'message:visible-response',
        phase: 'delta',
        content: 'Visible response'
      }
    }
    const close = vi.fn()
    fixture.agent.subscribe.mockImplementation(async (
      _principal: unknown,
      input: { runId: string; afterSeq: number },
      listener: (event: ExtensionAgentEvent) => Promise<void> | void
    ) => {
      if (input.afterSeq === -1) {
        await listener(hidden)
        return { lastDeliveredSeq: hidden.seq, closed: false, close }
      }
      if (input.afterSeq === hidden.seq) {
        await listener(publicEvent)
        return { lastDeliveredSeq: publicEvent.seq, closed: false, close }
      }
      return { lastDeliveredSeq: input.afterSeq, closed: false, close }
    })
    const headers = sessionHeaders(session.body.sessionId, session.body.nonce)

    const first = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/agent/runs/run_goal/events?cursor=0',
      undefined,
      headers
    )
    expect(first).toMatchObject({ status: 200, body: { events: [], nextCursor: 8, hasMore: false } })
    expect(JSON.stringify(first.body)).not.toContain('Internal goal text must not reach an extension')

    const second = await dispatchJson(
      router,
      'GET',
      `/v1/extensions/agent/runs/run_goal/events?cursor=${first.body.nextCursor}`,
      undefined,
      headers
    )
    expect(fixture.agent.subscribe).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { runId: 'run_goal', afterSeq: hidden.seq },
      expect.any(Function)
    )
    expect(second.body.events).toMatchObject([{ sequence: 9, type: 'message' }])
    expect(second.body.nextCursor).toBe(9)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('does not advance an agent polling cursor when its replay is empty', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const session = await createSession(router)
    fixture.agent.subscribe.mockResolvedValue({
      lastDeliveredSeq: -1,
      closed: false,
      close: vi.fn()
    })

    const response = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/agent/runs/run_empty/events?cursor=0',
      undefined,
      sessionHeaders(session.body.sessionId, session.body.nonce)
    )

    expect(response).toMatchObject({ status: 200, body: { events: [], nextCursor: 0, hasMore: false } })
  })

  it('pages public agent replay from the last returned event instead of the drained subscription tail', async () => {
    const fixture = await createFixture()
    const router = buildExtensionPublicRouter(fixture.runtime)
    const session = await createSession(router)
    const replay: ExtensionAgentEvent[] = [7, 8].map((seq) => ({
      seq,
      timestamp: `2026-07-11T08:00:0${seq - 7}.000Z`,
      type: 'assistant_text_delta',
      runId: 'run_page',
      threadId: 'thread_page',
      ownerExtensionId: 'acme.dashboard',
      payload: {
        role: 'assistant',
        messageId: `message:visible-response-${seq}`,
        phase: 'delta',
        content: `Visible response ${seq}`
      }
    }))
    fixture.agent.subscribe.mockImplementation(async (
      _principal: unknown,
      input: { runId: string; afterSeq: number },
      listener: (event: ExtensionAgentEvent) => Promise<void> | void
    ) => {
      for (const event of replay) {
        if (event.seq > input.afterSeq) await listener(event)
      }
      return {
        lastDeliveredSeq: replay.at(-1)!.seq,
        closed: false,
        close: vi.fn()
      }
    })
    const headers = sessionHeaders(session.body.sessionId, session.body.nonce)

    const first = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/agent/runs/run_page/events?cursor=0&limit=1',
      undefined,
      headers
    )
    expect(first.body.events).toMatchObject([{ sequence: 8 }])
    expect(first.body.nextCursor).toBe(8)

    const second = await dispatchJson(
      router,
      'GET',
      `/v1/extensions/agent/runs/run_page/events?cursor=${first.body.nextCursor}&limit=1`,
      undefined,
      headers
    )
    expect(fixture.agent.subscribe).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      { runId: 'run_page', afterSeq: 7 },
      expect.any(Function)
    )
    expect(second.body.events).toMatchObject([{ sequence: 9 }])
  })

  it('carries hidden agent-event cursors into SSE heartbeats without exposing their payload', async () => {
    vi.useFakeTimers()
    try {
      const fixture = await createFixture()
      const router = buildExtensionPublicRouter(fixture.runtime)
      const session = await createSession(router)
      const hidden: ExtensionAgentEvent = {
        seq: 7,
        timestamp: '2026-07-11T08:00:00.000Z',
        type: 'item_created',
        runId: 'run_goal',
        threadId: 'thread_goal',
        ownerExtensionId: 'acme.dashboard',
        payload: {
          item: { kind: 'goal_context', text: 'Internal goal text must not reach SSE' }
        }
      }
      const close = vi.fn()
      fixture.agent.subscribe.mockImplementation(async (
        _principal: unknown,
        input: { runId: string; afterSeq: number },
        listener: (event: ExtensionAgentEvent) => Promise<void> | void
      ) => {
        expect(input).toEqual({ runId: 'run_goal', afterSeq: -1 })
        await listener(hidden)
        return { lastDeliveredSeq: hidden.seq, closed: false, close }
      })

      const response = await dispatchRaw(
        router,
        'GET',
        '/v1/extensions/agent/runs/run_goal/events?cursor=0',
        undefined,
        {
          ...sessionHeaders(session.body.sessionId, session.body.nonce),
          accept: 'text/event-stream'
        }
      ) as Response
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(15_000)
      const reader = response.body!.getReader()
      const heartbeat = await reader.read()
      const text = new TextDecoder().decode(heartbeat.value)

      expect(text).toContain('id: 8')
      expect(text).toContain('event: heartbeat')
      expect(text).toContain('"cursor":8')
      expect(text).not.toContain('Internal goal text must not reach SSE')
      await reader.cancel()
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps raw-secret reveal decisions on the trusted runtime-token control plane', async () => {
    const fixture = await createFixture()
    fixture.secretReveals.list.mockReturnValue([{
      id: 'secret_reveal_12345678-1234-1234-1234-123456789abc',
      extensionId: 'acme.dashboard',
      extensionVersion: '1.0.0',
      accountId: 'account-1',
      operation: 'sign request',
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:01:00.000Z'
    }])
    fixture.secretReveals.decide.mockReturnValue(true)
    const router = buildExtensionPublicRouter(fixture.runtime)

    const unauthorized = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/secret-reveal-requests'
    )
    expect(unauthorized.status).toBe(401)
    const listed = await dispatchJson(
      router,
      'GET',
      '/v1/extensions/secret-reveal-requests',
      undefined,
      runtimeHeaders()
    )
    expect(listed.body.requests).toHaveLength(1)
    expect(listed.body.requests[0]).not.toHaveProperty('secret')
    const decided = await dispatchJson(
      router,
      'POST',
      '/v1/extensions/secret-reveal-requests/secret_reveal_12345678-1234-1234-1234-123456789abc/decision',
      { decision: 'allow' },
      runtimeHeaders()
    )
    expect(decided).toMatchObject({ status: 200, body: { decided: true } })
    expect(fixture.secretReveals.decide).toHaveBeenCalledWith(
      'secret_reveal_12345678-1234-1234-1234-123456789abc',
      'allow'
    )
  })
})
