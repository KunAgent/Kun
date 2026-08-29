import { afterEach, describe, expect, it, vi } from 'vitest'
import { KunRuntimeProvider } from './kun-runtime'
import { resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import { installDsGui } from './kun-runtime-test-support'

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider', () => {
  it('reports the kun id and Kun display name', () => {
    const provider = new KunRuntimeProvider()
    expect(provider.id).toBe('kun')
    expect(provider.displayName).toBe('Kun')
  })

  it('exposes the local HTTP/SSE capabilities', () => {
    const provider = new KunRuntimeProvider()
    const caps = provider.getCapabilities()
    expect(caps.stream).toBe(true)
    expect(caps.interrupt).toBe(true)
    expect(caps.approvals).toBe(true)
  })

  it('reports invalid runtime JSON responses with a stable error message', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: '{not-json'
      }))
    })
    const provider = new KunRuntimeProvider()

    await expect(provider.listThreads()).rejects.toThrow(
      'runtime returned an invalid thread list response'
    )
  })

  it('does not impose a hidden limit when listing the full thread inventory', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ threads: [] })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.listThreads({ includeArchived: true })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads?include_archived=true',
      'GET'
    )
  })

  it('preserves an explicit thread list limit for bounded callers', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ threads: [] })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.listThreads({ limit: 25 })

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/threads?limit=25', 'GET')
  })

  it('rejects thread creation before the runtime request when the workspace is missing', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const alertDialog = vi.fn(async () => undefined)
    installDsGui({
      runtimeRequest,
      workspaceDirectoryExists: vi.fn(async () => false),
      alertDialog
    })
    const provider = new KunRuntimeProvider()

    await expect(provider.createThread({ workspace: 'E:\\missing-project' }))
      .rejects.toThrow(/working directory/i)

    expect(runtimeRequest).not.toHaveBeenCalled()
    expect(alertDialog).not.toHaveBeenCalled()
  })

  it('does not fall back to stale GUI settings when the shared registry has no connected default', async () => {
    const runtimeRequest = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/model-connections')
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          revision: 3,
          providers: [],
          proxy: { enabled: false, url: '' },
          routePools: [],
          localModelGateway: { enabled: false }
        })
      }
    })
    installDsGui({
      runtimeRequest,
      workspaceDirectoryExists: vi.fn(async () => true)
    })

    await expect(new KunRuntimeProvider().createThread({ workspace: '/tmp/workspace' }))
      .rejects.toThrow(/connected model/i)
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })

  it('creates a new GUI session from the live shared default rather than stale local settings', async () => {
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/model-connections') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            schemaVersion: 1,
            revision: 4,
            providers: [{
              id: 'codex',
              accountId: 'account:codex',
              configured: true,
              models: ['gpt-live']
            }],
            defaultProviderId: 'codex',
            defaultAccountId: 'account:codex',
            defaultModel: 'gpt-live'
          })
        }
      }
      expect(path).toBe('/v1/threads')
      expect(method).toBe('POST')
      expect(JSON.parse(body ?? '{}')).toMatchObject({
        providerId: 'codex',
        accountId: 'account:codex',
        model: 'gpt-live',
        agentSurface: 'design',
        modelRequestCaptureEnabled: false
      })
      return {
        ok: true,
        status: 201,
        body: JSON.stringify({
          id: 'thr_live',
          title: 'Live',
          agentSurface: 'design',
          workspace: '/tmp/workspace',
          model: 'gpt-live',
          providerId: 'codex',
          accountId: 'account:codex',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't0',
          turns: []
        })
      }
    })
    installDsGui({
      runtimeRequest,
      workspaceDirectoryExists: vi.fn(async () => true)
    })

    await expect(new KunRuntimeProvider().createThread({
      workspace: '/tmp/workspace',
      agentSurface: 'design'
    })).resolves.toMatchObject({ id: 'thr_live', model: 'gpt-live', agentSurface: 'design' })
  })

  it('starts MCP OAuth authorization through the authenticated runtime bridge', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ serverId: 'google_drive', status: 'authorized', authorized: true })
    }))
    installDsGui({ runtimeRequest })

    const result = await new KunRuntimeProvider().authorizeMcpOAuthCredentials('google_drive')

    expect(runtimeRequest).toHaveBeenCalledWith('/v1/mcp/oauth/google_drive', 'POST')
    expect(result).toEqual({ serverId: 'google_drive', status: 'authorized', authorized: true })
  })

  it('maps Kun thread items into chat blocks', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_1',
          title: 'Demo',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 9,
          turns: [
            {
              id: 'turn_1',
              threadId: 'thr_1',
              status: 'completed',
              prompt: 'hi',
              createdAt: '2026-05-25T09:00:00.000Z',
              startedAt: '2026-05-25T09:00:01.000Z',
              finishedAt: '2026-05-25T09:01:42.000Z',
              mode: 'plan',
              guiDesignCanvas: true,
              items: [
                {
                  id: 'item_user',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'user',
                  status: 'completed',
                  createdAt: '2026-05-25T09:00:00.000Z',
                  kind: 'user_message',
                  text: 'hi'
                },
                {
                  id: 'item_answer',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'completed',
                  createdAt: '2026-05-25T09:01:41.000Z',
                  finishedAt: '2026-05-25T09:01:42.000Z',
                  kind: 'assistant_text',
                  text: 'hello'
                }
              ]
            }
          ]
        })
      }))
    })
    const provider = new KunRuntimeProvider()
    const detail = await provider.getThreadDetail('thr_1')
    expect(detail.blocks.map((block) => block.kind)).toEqual(['user', 'assistant'])
    expect(detail.blocks[0]).toMatchObject({
      kind: 'user',
      meta: { guiDesignCanvas: true, mode: 'plan' }
    })
    expect(detail.latestSeq).toBe(9)
    expect(detail.latestTurnId).toBe('turn_1')
    expect(detail.latestUserMessageId).toBe('item_user')
    expect(detail.turnDurationByUserId).toEqual({ item_user: 101_000 })
  })

  it('does not infer a missing turn mode from a Plan thread', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_legacy_plan', title: 'Legacy Plan', workspace: '/tmp',
          model: 'deepseek-chat', mode: 'plan', status: 'running',
          createdAt: 't0', updatedAt: 't1', latestSeq: 1,
          turns: [{
            id: 'turn_unknown', threadId: 'thr_legacy_plan', status: 'running',
            prompt: 'continue', createdAt: 't0', items: [{
              id: 'item_unknown', turnId: 'turn_unknown', threadId: 'thr_legacy_plan',
              role: 'user', status: 'completed', createdAt: 't0',
              kind: 'user_message', text: 'continue'
            }]
          }]
        })
      }))
    })

    const detail = await new KunRuntimeProvider().getThreadDetail('thr_legacy_plan')
    expect(detail.blocks[0]).toMatchObject({ kind: 'user' })
    expect(detail.blocks[0]).not.toMatchObject({ meta: { mode: 'plan' } })
  })

  it.each([
    ['graph', 'graph', 'graph'],
    ['direct', 'direct', 'direct'],
    ['legacy missing', undefined, 'direct']
  ] as const)('normalizes %s latest-turn orchestration', async (_label, orchestration, expected) => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_orchestration',
          title: 'Orchestration',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'running',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 1,
          turns: [{
            id: 'turn_orchestration',
            threadId: 'thr_orchestration',
            status: 'running',
            prompt: 'continue',
            createdAt: 't0',
            ...(orchestration ? { orchestration } : {}),
            items: []
          }]
        })
      }))
    })

    const detail = await new KunRuntimeProvider().getThreadDetail('thr_orchestration')

    expect(detail.latestTurnOrchestration).toBe(expected)
  })

  it('restores unfinished latest-turn text as the live projection', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_running',
          title: 'Running',
          workspace: '/tmp',
          model: 'deepseek-chat',
          mode: 'agent',
          status: 'running',
          createdAt: 't0',
          updatedAt: 't3',
          latestSeq: 17,
          turns: [{
            id: 'turn_running',
            threadId: 'thr_running',
            status: 'running',
            prompt: 'continue',
            createdAt: 't0',
            items: [
              {
                id: 'item_user', turnId: 'turn_running', threadId: 'thr_running',
                role: 'user', status: 'completed', createdAt: 't0',
                kind: 'user_message', text: 'continue'
              },
              {
                id: 'item_reasoning', turnId: 'turn_running', threadId: 'thr_running',
                role: 'assistant', status: 'running', createdAt: 't1',
                kind: 'assistant_reasoning', text: 'still reasoning'
              },
              {
                id: 'item_answer', turnId: 'turn_running', threadId: 'thr_running',
                role: 'assistant', status: 'running', createdAt: 't2',
                kind: 'assistant_text', text: 'partial answer'
              }
            ]
          }]
        })
      }))
    })

    const detail = await new KunRuntimeProvider().getThreadDetail('thr_running')

    expect(detail.blocks).toEqual([
      expect.objectContaining({ kind: 'user', id: 'item_user', text: 'continue' })
    ])
    expect(detail.liveProjection).toEqual({
      reasoning: {
        text: 'still reasoning', itemId: 'item_reasoning',
        turnId: 'turn_running', createdAt: 't1'
      },
      assistant: {
        text: 'partial answer', itemId: 'item_answer',
        turnId: 'turn_running', createdAt: 't2'
      }
    })
  })

  it('loads lightweight thread state without requesting full detail', async () => {
    const runtimeRequest = vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        id: 'thr_state',
        status: 'running',
        updatedAt: '2026-08-07T00:00:00.000Z',
        latestSeq: 91,
        pendingUserInputIds: ['input-state'],
        latestTurn: { id: 'turn_state', status: 'running', orchestration: 'direct' }
      })
    }))
    installDsGui({ runtimeRequest })

    await expect(new KunRuntimeProvider().getThreadState('thr_state')).resolves.toEqual({
      status: 'running',
      updatedAt: '2026-08-07T00:00:00.000Z',
      latestSeq: 91,
      pendingUserInputIds: ['input-state'],
      latestTurnId: 'turn_state',
      latestTurnStatus: 'running',
      latestTurnOrchestration: 'direct'
    })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/threads/thr_state/state', 'GET')
  })

  it('maps batch thread states and keeps per-thread failures', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        results: [
          {
            id: 'thr_waiting',
            ok: true,
            state: {
              id: 'thr_waiting',
              status: 'running',
              updatedAt: '2026-08-07T00:00:00.000Z',
              latestSeq: 92,
              pendingUserInputIds: ['input-waiting'],
              latestTurn: null
            }
          },
          {
            id: 'thr_missing',
            ok: false,
            error: { code: 'not_found', message: 'thread not found: thr_missing' }
          }
        ]
      })
    }))
    installDsGui({ runtimeRequest })

    await expect(new KunRuntimeProvider().getThreadStates([
      'thr_waiting', 'thr_missing'
    ])).resolves.toEqual([
      {
        id: 'thr_waiting',
        ok: true,
        state: {
          status: 'running',
          updatedAt: '2026-08-07T00:00:00.000Z',
          latestSeq: 92,
          pendingUserInputIds: ['input-waiting']
        }
      },
      {
        id: 'thr_missing',
        ok: false,
        error: { code: 'not_found', message: 'thread not found: thr_missing' }
      }
    ])
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/states',
      'POST',
      JSON.stringify({ threadIds: ['thr_waiting', 'thr_missing'] })
    )
  })

  it('falls back to legacy full detail only when the timeline route is unavailable', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        body: JSON.stringify({ code: 'not_found', message: 'route not found' })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_legacy',
          title: 'Legacy',
          workspace: '/tmp',
          model: 'm',
          mode: 'agent',
          status: 'idle',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 0,
          turns: []
        })
      })
    installDsGui({ runtimeRequest })

    await expect(new KunRuntimeProvider().getThreadDetail('thr_legacy'))
      .resolves.toMatchObject({ blocks: [], latestSeq: 0 })
    expect(runtimeRequest).toHaveBeenNthCalledWith(
      2,
      '/v1/threads/thr_legacy',
      'GET'
    )
  })

  it('does not fall back to unbounded detail when timeline hydration fails', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: false,
      status: 500,
      body: JSON.stringify({ code: 'internal_error', message: 'manager page read failed' })
    }))
    installDsGui({ runtimeRequest })

    await expect(new KunRuntimeProvider().getThreadDetail('thr_large'))
      .rejects.toThrow('manager page read failed')
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })

  it('rehydrates persisted partial assistant output for a running turn', async () => {
    installDsGui({
      runtimeRequest: vi.fn(async () => ({
        ok: true,
        status: 200,
        body: JSON.stringify({
          id: 'thr_cursor',
          title: 'Cursor turn',
          workspace: '/tmp',
          model: 'grok-4.5',
          mode: 'agent',
          status: 'running',
          createdAt: 't0',
          updatedAt: 't1',
          latestSeq: 42,
          turns: [{
            id: 'turn_cursor',
            threadId: 'thr_cursor',
            status: 'running',
            prompt: 'review',
            createdAt: 't0',
            items: [{
              id: 'item_user',
              turnId: 'turn_cursor',
              threadId: 'thr_cursor',
              role: 'user',
              status: 'completed',
              createdAt: 't0',
              kind: 'user_message',
              text: 'review'
            }, {
              id: 'item_cursor_text',
              turnId: 'turn_cursor',
              threadId: 'thr_cursor',
              role: 'assistant',
              status: 'running',
              createdAt: 't1',
              kind: 'assistant_text',
              text: 'partial Cursor response'
            }]
          }]
        })
      }))
    })

    const detail = await new KunRuntimeProvider().getThreadDetail('thr_cursor')

    expect(detail.threadStatus).toBe('running')
    expect(detail.blocks.some((block) => block.id === 'item_cursor_text')).toBe(false)
    expect(detail.liveProjection?.assistant).toEqual({
      itemId: 'item_cursor_text',
      turnId: 'turn_cursor',
      createdAt: 't1',
      text: 'partial Cursor response'
    })
  })

  it('flags user_input blocks live only when the runtime gate still awaits them (#606)', async () => {
    const threadBody = (pendingUserInputIds: string[]): string =>
      JSON.stringify({
        id: 'thr_1',
        title: 'Demo',
        workspace: '/tmp',
        model: 'deepseek-chat',
        mode: 'agent',
        status: 'running',
        createdAt: 't0',
        updatedAt: 't1',
        latestSeq: 9,
        pendingUserInputIds,
        turns: [
          {
            id: 'turn_1',
            threadId: 'thr_1',
            status: 'running',
            prompt: 'hi',
            createdAt: 't0',
            items: [
              {
                id: 'item_input',
                turnId: 'turn_1',
                threadId: 'thr_1',
                role: 'assistant',
                status: 'pending',
                createdAt: 't1',
                kind: 'user_input',
                inputId: 'in_live',
                prompt: 'north or south?'
              }
            ]
          }
        ]
      })

    // Gate still awaiting in_live -> the rehydrated prompt stays answerable.
    installDsGui({
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: threadBody(['in_live']) }))
    })
    const liveDetail = await new KunRuntimeProvider().getThreadDetail('thr_1')
    const liveBlock = liveDetail.blocks.find((block) => block.kind === 'user_input')
    expect(liveBlock).toMatchObject({ requestId: 'in_live', status: 'pending', live: true })

    // Gate empty (finished thread) -> the same pending item is NOT live.
    resetProviderCacheForTests()
    installDsGui({
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: threadBody([]) }))
    })
    const staleDetail = await new KunRuntimeProvider().getThreadDetail('thr_1')
    const staleBlock = staleDetail.blocks.find((block) => block.kind === 'user_input')
    expect(staleBlock?.kind === 'user_input' && staleBlock.live).toBeFalsy()
  })

})
