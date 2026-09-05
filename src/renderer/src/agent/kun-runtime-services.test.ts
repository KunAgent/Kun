import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { KunRuntimeProvider } from './kun-runtime'
import { getProvider, resetProviderCacheForTests } from './registry'
import { rendererRuntimeClient } from './runtime-client'
import type { ThreadEventSink } from './types'

const DEFAULT_EXECUTION_SETTINGS = {
  approvalPolicy: 'auto',
  sandboxMode: 'danger-full-access',
  approvalReviewer: 'user'
} as const

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function installDsGui(overrides: Partial<Window['kunGui']>): void {
  vi.stubGlobal('window', {
    kunGui: {
      getSettings: vi.fn(async () => settings()),
      runtimeRequest: vi.fn(async () => ({ ok: true, status: 200, body: '{}' })),
      resolveKunApproval: vi.fn(async () => ({
        confirmed: true,
        response: { ok: true, status: 200, body: '{}' }
      })),
      startSse: vi.fn(async (_threadId: string, _sinceSeq: number, streamId?: string) => ({
        streamId: streamId ?? 'stream-1'
      })),
      stopSse: vi.fn(async () => true),
      ackSse: vi.fn(async () => true),
      onSseOpen: vi.fn(() => () => undefined),
      onSseEvent: vi.fn(() => () => undefined),
      onSseEnd: vi.fn(() => () => undefined),
      onSseError: vi.fn(() => () => undefined),
      ...overrides
    }
  })
}

afterEach(() => {
  rendererRuntimeClient.invalidateSettings()
  vi.unstubAllGlobals()
})

describe('KunRuntimeProvider', () => {
  it('loads runtime diagnostics and uploads image attachments through Kun endpoints', async () => {
    const runtimeRequest = vi.fn(async (path: string) => {
      if (path === '/v1/runtime/info') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            host: '127.0.0.1',
            port: 17878,
            dataDir: '/tmp/kun',
            startedAt: '2024-01-01T00:00:00.000Z',
            capabilities: {
              contractVersion: 1,
              model: {
                id: 'deepseek-chat',
                inputModalities: ['text', 'image'],
                outputModalities: ['text'],
                supportsToolCalling: true,
                messageParts: ['text', 'image_url']
              },
              cli: {
                serve: { status: 'available', enabled: true, available: true },
                run: { status: 'available', enabled: true, available: true },
                chat: { status: 'available', enabled: true, available: true },
                exec: { status: 'available', enabled: true, available: true }
              },
              mcp: { status: 'disabled', enabled: false, available: false, configuredServers: 0, connectedServers: 0, toolCount: 0 },
              web: {
                status: 'available',
                enabled: true,
                available: true,
                fetch: { status: 'available', enabled: true, available: true },
                search: { status: 'disabled', enabled: false, available: false }
              },
              skills: { status: 'disabled', enabled: false, available: false, configuredRoots: 0, discoveredSkills: 0 },
              subagents: { status: 'disabled', enabled: false, available: false, maxParallel: 0 },
              attachments: {
                status: 'available',
                enabled: true,
                available: true,
                maxImageBytes: 5242880,
                maxImageDimension: 4096,
                allowedMimeTypes: ['image/png'],
                textFallbackMaxBase64Bytes: 524288,
                textFallbackMaxImageDimension: 1280,
                textFallbackPreferredMimeType: 'image/webp'
              },
              memory: { status: 'disabled', enabled: false, available: false, scopes: ['user'], maxInjectedRecords: 8 }
            }
          })
        }
      }
      if (path === '/v1/runtime/tools') {
        return { ok: true, status: 200, body: JSON.stringify({ providers: [{ id: 'web' }] }) }
      }
      if (path === '/v1/skills') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            skills: [{
              id: 'review',
              name: 'Review',
              description: 'Review changes'
            }]
          })
        }
      }
      if (path === '/v1/attachments') {
        return {
          ok: true,
          status: 201,
          body: JSON.stringify({
            attachment: {
              id: 'att_1',
              name: 'shot.png',
              mimeType: 'image/png',
              byteSize: 3,
              hash: 'hash',
              localFilePath: '/tmp/picked/shot.png',
              createdAt: 't0',
              updatedAt: 't0'
            }
          })
        }
      }
      if (path === '/v1/attachments/att_1/content?thread_id=thr_1') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            attachment: {
              id: 'att_1',
              name: 'shot.png',
              mimeType: 'image/png',
              byteSize: 3,
              hash: 'hash',
              localFilePath: '/tmp/picked/shot.png',
              createdAt: 't0',
              updatedAt: 't0'
            },
            dataBase64: 'abc'
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.getRuntimeInfo()).resolves.toMatchObject({
      capabilities: { attachments: { available: true } }
    })
    await expect(provider.getToolDiagnostics()).resolves.toMatchObject({
      providers: [{ id: 'web' }]
    })
    await expect(provider.listSkills()).resolves.toEqual([
      expect.objectContaining({
        id: 'review',
        name: 'Review',
        description: 'Review changes'
      })
    ])
    await expect(provider.uploadAttachment({
      name: 'shot.png',
      mimeType: 'image/png',
      dataBase64: 'abc',
      localFilePath: '/tmp/picked/shot.png',
      textFallback: {
        dataBase64: 'xyz',
        mimeType: 'image/webp',
        byteSize: 2,
        width: 1,
        height: 1,
        wasCompressed: true
      },
      threadId: 'thr_1'
    })).resolves.toMatchObject({ id: 'att_1', name: 'shot.png', localFilePath: '/tmp/picked/shot.png' })
    await expect(provider.getAttachmentContent('att_1', { threadId: 'thr_1' })).resolves.toMatchObject({
      attachment: { id: 'att_1', mimeType: 'image/png' },
      dataBase64: 'abc'
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/attachments',
      'POST',
      JSON.stringify({
        name: 'shot.png',
        mimeType: 'image/png',
        dataBase64: 'abc',
        localFilePath: '/tmp/picked/shot.png',
        textFallback: {
          dataBase64: 'xyz',
          mimeType: 'image/webp',
          byteSize: 2,
          width: 1,
          height: 1,
          wasCompressed: true
        },
        threadId: 'thr_1'
      })
    )
    await expect(provider.uploadAttachment({
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      dataBase64: 'JVBERi0=',
      documentText: 'PDF body',
      pageCount: 2,
      localFilePath: '/tmp/picked/spec.pdf',
      workspace: '/tmp/ws'
    })).resolves.toMatchObject({ id: 'att_1' })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/attachments',
      'POST',
      JSON.stringify({
        name: 'spec.pdf',
        mimeType: 'application/pdf',
        dataBase64: 'JVBERi0=',
        documentText: 'PDF body',
        pageCount: 2,
        localFilePath: '/tmp/picked/spec.pdf',
        workspace: '/tmp/ws'
      })
    )
  })

  it('routes image uploads through the dedicated desktop bridge when available', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const uploadRuntimeImageAttachment = vi.fn(async () => ({
      ok: true as const,
      attachment: {
        id: 'att_bridge',
        name: 'large.webp',
        kind: 'image' as const,
        mimeType: 'image/webp',
        byteSize: 1024,
        hash: 'hash',
        createdAt: 't0',
        updatedAt: 't0'
      },
      preview: { dataBase64: 'AQID', mimeType: 'image/webp', byteSize: 3 },
      compression: {
        sourceBytes: 8 * 1024 * 1024,
        outputBytes: 1024,
        fallbackBytes: 3,
        wasCompressed: true
      }
    }))
    installDsGui({ runtimeRequest, uploadRuntimeImageAttachment })
    const provider = new KunRuntimeProvider()

    await expect(provider.uploadAttachment({
      name: 'large.png',
      mimeType: 'image/png',
      dataBase64: 'unused',
      localFilePath: '/tmp/large.png',
      threadId: 'thr_1'
    })).resolves.toMatchObject({ id: 'att_bridge', mimeType: 'image/webp' })
    expect(uploadRuntimeImageAttachment).toHaveBeenCalledWith({
      source: { kind: 'localPath', path: '/tmp/large.png' },
      name: 'large.png',
      threadId: 'thr_1'
    })
    expect(runtimeRequest).not.toHaveBeenCalled()
  })

  it('lists, toggles, and deletes memory records through Kun endpoints', async () => {
    const memoryPatches: string[] = []
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (path === '/v1/memory?workspace=%2Ftmp%2Fworkspace&include_deleted=false') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memories: [{
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              workspace: '/tmp/workspace',
              tags: ['tooling'],
              confidence: 0.9,
              createdAt: 't0',
              updatedAt: 't0'
            }]
          })
        }
      }
      if (path === '/v1/memory/mem_1?workspace=%2Ftmp%2Fworkspace' && method === 'PATCH') {
        memoryPatches.push(body ?? '')
        const disabled = JSON.parse(body ?? '{}').disabled === true
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memory: {
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              ...(disabled ? { disabledAt: 't1' } : {}),
              createdAt: 't0',
              updatedAt: disabled ? 't1' : 't2'
            }
          })
        }
      }
      if (path === '/v1/memory/mem_1?workspace=%2Ftmp%2Fworkspace' && method === 'DELETE') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            memory: {
              id: 'mem_1',
              content: 'Use pnpm',
              scope: 'workspace',
              deletedAt: 't2',
              createdAt: 't0',
              updatedAt: 't2'
            }
          })
        }
      }
      return { ok: true, status: 200, body: '{}' }
    })
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.listMemories({ workspace: '/tmp/workspace', includeDeleted: false })).resolves.toHaveLength(1)
    await expect(provider.updateMemory('mem_1', { disabled: true }, { workspace: '/tmp/workspace' })).resolves.toMatchObject({
      id: 'mem_1',
      disabledAt: 't1'
    })
    await expect(provider.updateMemory('mem_1', { disabled: false }, { workspace: '/tmp/workspace' })).resolves.toMatchObject({
      id: 'mem_1',
      updatedAt: 't2'
    })
    expect(memoryPatches).toEqual([
      JSON.stringify({ disabled: true }),
      JSON.stringify({ disabled: false })
    ])
    await expect(provider.deleteMemory('mem_1', { workspace: '/tmp/workspace' })).resolves.toMatchObject({
      id: 'mem_1',
      deletedAt: 't2'
    })
  })

  it('passes portable expiry and disabled state through memory creation', async () => {
    const runtimeRequest = vi.fn(async (_path: string, _method?: string, body?: string) => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        memory: {
          id: 'mem_portable',
          ...JSON.parse(body ?? '{}'),
          disabledAt: '2026-09-01T00:00:00.000Z',
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z'
        }
      })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    const input = {
      content: 'Portable disabled memory',
      scope: 'user' as const,
      expiresAt: '2027-01-01T00:00:00.000Z',
      disabled: true
    }

    await expect(provider.createMemory(input)).resolves.toMatchObject({
      id: 'mem_portable',
      expiresAt: input.expiresAt,
      disabledAt: '2026-09-01T00:00:00.000Z'
    })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/memory', 'POST', JSON.stringify(input))
  })

  it('calls Kun fork and user-input compatibility endpoints', async () => {
    const runtimeRequest = vi.fn(async (path: string) => ({
      ok: true,
      status: 200,
      body: path.includes('/fork')
        ? JSON.stringify({
            id: 'thr_fork',
            title: 'Forked',
            workspace: '/tmp/workspace',
            model: 'deepseek-chat',
            mode: 'agent',
            status: 'idle',
            forkedFromThreadId: 'thr_parent',
            createdAt: 't0',
            updatedAt: 't1'
          })
        : '{}'
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    const forked = await provider.forkThread('thr_parent')
    await provider.forkThread('thr_parent', { turnId: 'turn_1' })
    await provider.submitUserInputResponse('input_1', [
      {
        id: 'choice',
        label: 'Yes, Maybe',
        value: 'Yes, Maybe',
        labels: ['Yes', 'Maybe'],
        values: ['Yes', 'Maybe']
      }
    ])
    await provider.cancelUserInput('input_2')

    expect(forked).toMatchObject({ id: 'thr_fork', forkedFromThreadId: 'thr_parent' })
    expect(runtimeRequest).toHaveBeenCalledWith('/v1/threads/thr_parent/fork', 'POST')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_parent/fork',
      'POST',
      JSON.stringify({ turnId: 'turn_1' })
    )
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/user-inputs/input_1',
      'POST',
      JSON.stringify({
        answers: [
          {
            id: 'choice',
            label: 'Yes, Maybe',
            value: 'Yes, Maybe',
            labels: ['Yes', 'Maybe'],
            values: ['Yes', 'Maybe']
          }
        ]
      })
    )
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/user-inputs/input_2',
      'POST',
      JSON.stringify({ cancelled: true })
    )
  })

  it('uses the shared knowledge-base paths for mount, status, and reindex operations', async () => {
    const mount = {
      id: 'kb/docs',
      root: '/tmp/knowledge docs',
      name: 'Knowledge docs',
      source: 'write-workspace' as const,
      access: 'read-only' as const
    }
    const runtimeRequest = vi.fn(async (path: string, method?: string) => {
      if (method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            id: 'thr/one',
            title: 'Knowledge task',
            workspace: '/tmp/workspace',
            model: 'deepseek-chat',
            mode: 'agent',
            status: 'idle',
            knowledgeBases: [mount],
            createdAt: 't0',
            updatedAt: 't1'
          })
        }
      }
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          body: JSON.stringify({
            mounts: [mount],
            statuses: [{ id: mount.id, state: 'ready', documentCount: 1, nodeCount: 3 }]
          })
        }
      }
      return {
        ok: true,
        status: 200,
        body: JSON.stringify({ id: mount.id, state: 'ready', documentCount: 1, nodeCount: 3 })
      }
    })
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.updateThreadKnowledgeBases('thr/one', [mount])).resolves.toMatchObject({
      id: 'thr/one',
      knowledgeBases: [mount]
    })
    await expect(provider.getThreadKnowledgeBases('thr/one')).resolves.toMatchObject({
      statuses: [{ id: mount.id, state: 'ready' }]
    })
    await expect(provider.reindexThreadKnowledgeBase('thr/one', mount.id)).resolves.toMatchObject({
      id: mount.id,
      state: 'ready'
    })

    expect(runtimeRequest).toHaveBeenNthCalledWith(
      1,
      '/v1/threads/thr%2Fone',
      'PATCH',
      JSON.stringify({ knowledgeBases: [mount] })
    )
    expect(runtimeRequest).toHaveBeenNthCalledWith(
      2,
      '/v1/threads/thr%2Fone/knowledge-bases',
      'GET'
    )
    expect(runtimeRequest).toHaveBeenNthCalledWith(
      3,
      '/v1/threads/thr%2Fone/knowledge-bases/kb%2Fdocs/reindex',
      'POST'
    )
  })

  it('resumes a session through the Kun HTTP runtime', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 201,
      body: JSON.stringify({ thread_id: 'thr_resumed', session_id: 'sess_1' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    const result = await provider.resumeSession('sess_1', { mode: 'plan' })

    expect(result).toEqual({ threadId: 'thr_resumed', sessionId: 'sess_1' })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/sessions/sess_1/resume-thread',
      'POST',
      JSON.stringify({
        workspace: '/tmp/workspace',
        model: defaultKunRuntimeSettings().model,
        mode: 'plan'
      })
    )
  })

  it('syncs plan todos through the dedicated runtime endpoint', async () => {
    const todos = { threadId: 'thr_1', items: [], updatedAt: '2026-08-31T00:00:00.000Z' }
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({ todos })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    const plan = { planId: 'plan_1', relativePath: '.kunsdd/plan/demo.md', markdown: '- [ ] task' }

    await expect(provider.syncThreadTodosFromPlan('thr_1', plan)).resolves.toMatchObject({
      threadId: 'thr_1', items: []
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/todos/sync-plan',
      'POST',
      JSON.stringify(plan)
    )
  })

  it('reads session-only Design metadata before cloning a resume target', async () => {
    const metadata = {
      sessionId: 'sess_design',
      sourceAgentSurface: 'design' as const,
      workspace: '/tmp/design-workspace',
      sourceDesignProfile: {
        version: 1 as const,
        documentTarget: { documentId: 'doc_source', boardArtifactId: 'board_main' },
        outputMedium: 'html' as const,
        target: 'web' as const,
        preset: 'none' as const,
        context: { tone: [] },
        lockedAtTurnId: 'turn_lock'
      },
      sourceDesignDocumentTarget: { documentId: 'doc_source', boardArtifactId: 'board_main' },
      requiresIndependentDesignTarget: true
    }
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify(metadata)
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await expect(provider.getResumeSessionMetadata('sess_design')).resolves.toEqual(metadata)
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/sessions/sess_design/resume-metadata',
      'GET'
    )
  })

})
