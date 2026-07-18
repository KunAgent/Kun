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

function settings(): AppSettingsV1 {
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    provider: defaultModelProviderSettings(),
    agents: {
      kun: defaultKunRuntimeSettings()
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { enabled: false, intervalDays: 3 },
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
              createdAt: 't0',
              guiDesignCanvas: true,
              items: [
                {
                  id: 'item_user',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'user',
                  status: 'completed',
                  createdAt: 't0',
                  kind: 'user_message',
                  text: 'hi'
                },
                {
                  id: 'item_answer',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'completed',
                  createdAt: 't1',
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
      meta: { guiDesignCanvas: true }
    })
    expect(detail.latestSeq).toBe(9)
    expect(detail.latestTurnId).toBe('turn_1')
    expect(detail.latestUserMessageId).toBe('item_user')
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

  it('coalesces tool_call and tool_result pairs into one tool block on thread load', async () => {
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
              prompt: 'run echo',
              createdAt: 't0',
              items: [
                {
                  id: 'item_call',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'pending',
                  createdAt: 't0',
                  kind: 'tool_call',
                  toolName: 'echo',
                  callId: 'call_1',
                  arguments: { text: 'hi' }
                },
                {
                  id: 'item_result',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'tool',
                  status: 'completed',
                  createdAt: 't1',
                  kind: 'tool_result',
                  toolName: 'echo',
                  callId: 'call_1',
                  output: { echoed: 'hi' }
                }
              ]
            }
          ]
        })
      }))
    })
    const provider = new KunRuntimeProvider()
    const detail = await provider.getThreadDetail('thr_1')
    expect(detail.blocks).toHaveLength(1)
    expect(detail.blocks[0]).toMatchObject({
      kind: 'tool',
      id: 'tool_call_1',
      status: 'success'
    })
  })

  it('posts Kun turn requests and returns the deterministic user item id', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    const result = await provider.sendUserMessage('thr_1', 'hello')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'hello',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      })
    )
    expect(result.userMessageItemId).toBe('item_user_real')
  })

  it('posts per-turn provider ids with Kun turn requests when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('thr_1', 'hello', {
      model: 'mimo-v2.5',
      providerId: 'xiaomi-token-plan'
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'hello',
        model: 'mimo-v2.5',
        providerId: 'xiaomi-token-plan',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write'
      })
    )
  })

  it('posts workspace checkpoint ids with Kun turn requests when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('thr_1', 'hello', { workspaceCheckpointId: 'gcp_1' })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'hello',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        workspaceCheckpointId: 'gcp_1'
      })
    )
  })

  it('posts bounded extension composer context with the next Kun turn', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    const composerContext = {
      schemaVersion: 1 as const,
      id: 'video-selection',
      title: 'Interview selection',
      summary: 'Revision 4 with two selected clips',
      reference: { projectId: 'project-1', selectedItemIds: ['clip-1'] },
      revision: 4,
      generation: 7,
      attachmentId: `extension-context:${'a'.repeat(64)}`,
      provenance: {
        extensionId: 'acme.video-editor',
        extensionVersion: '1.1.0',
        viewContributionId: 'extension:acme.video-editor/editor',
        workspaceId: 'b'.repeat(64)
      }
    }
    await provider.sendUserMessage('thr_1', 'Use the selection', {
      composerContexts: [composerContext]
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'Use the selection',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        composerContexts: [composerContext]
      })
    )
  })

  it('posts GUI design canvas turn metadata when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_canvas', userMessageItemId: 'item_user_canvas' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('thr_1', 'design a screen', {
      guiDesignCanvas: true,
      guiDesignMode: true
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'design a screen',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        guiDesignCanvas: true,
        guiDesignMode: true
      })
    )
  })

  it('posts the reserved SVG artifact context for structured SVG turns', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_svg', userMessageItemId: 'item_user_svg' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('thr_1', 'animate the mark', {
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'motion',
        relativePath: '.kun-design/doc/motion/v2.svg'
      }
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'animate the mark',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        guiDesignMode: true,
        guiDesignArtifact: {
          kind: 'svg',
          artifactId: 'motion',
          relativePath: '.kun-design/doc/motion/v2.svg'
        }
      })
    )
  })

  it('posts rewind requests to the runtime', async () => {
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.rewindThread('thr_1', 'turn_1')
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/rewind',
      'POST',
      JSON.stringify({ turnId: 'turn_1' })
    )
  })

  it('posts attachment ids with Kun turn requests when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_img', userMessageItemId: 'item_user_img' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'describe this', { attachmentIds: ['att_1'] })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'describe this',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        attachmentIds: ['att_1']
      })
    )
  })

  it('posts file references with Kun turn requests when provided', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_files', userMessageItemId: 'item_user_files' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'explain these files', {
      fileReferences: [
        {
          path: '/workspace/deepseek-gui/src/App.tsx',
          relativePath: 'src/App.tsx',
          name: 'App.tsx',
          kind: 'file'
        },
        {
          path: '/workspace/deepseek-gui/src',
          relativePath: 'src',
          name: 'src',
          kind: 'directory'
        }
      ]
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'explain these files',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        fileReferences: [
          {
            path: '/workspace/deepseek-gui/src/App.tsx',
            relativePath: 'src/App.tsx',
            name: 'App.tsx',
            kind: 'file'
          },
          {
            path: '/workspace/deepseek-gui/src',
            relativePath: 'src',
            name: 'src',
            kind: 'directory'
          }
        ]
      })
    )
  })

  it('posts explicit reasoning effort with Kun turn requests', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_reason', userMessageItemId: 'item_user_reason' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'think harder', {
      model: 'auto',
      reasoningEffort: 'max'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'think harder',
        model: 'auto',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        reasoningEffort: 'max'
      })
    )
  })

  it('posts GUI plan context with Kun plan turn requests', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_plan', userMessageItemId: 'item_user_plan' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.sendUserMessage('thr_1', 'refine the plan', {
      mode: 'plan',
      displayText: 'Generate implementation plan',
      guiPlan: {
        operation: 'refine',
        workspaceRoot: '/workspace/deepseek-gui',
        relativePath: '.kunsdd/plan/auth.md',
        planId: '/workspace/deepseek-gui:.kunsdd/plan/auth.md',
        sourceRequest: 'Add auth',
        title: 'auth'
      }
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'refine the plan',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        displayText: 'Generate implementation plan',
        mode: 'plan',
        guiPlan: {
          operation: 'refine',
          workspaceRoot: '/workspace/deepseek-gui',
          relativePath: '.kunsdd/plan/auth.md',
          planId: '/workspace/deepseek-gui:.kunsdd/plan/auth.md',
          sourceRequest: 'Add auth',
          title: 'auth'
        }
      })
    )
  })

  it('posts interrupt requests with the discard option when requested', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: '{}'
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.interruptTurn('thr_1', 'turn_1', { discard: true })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns/turn_1/interrupt',
      'POST',
      JSON.stringify({ discard: true })
    )
  })

  it('posts mid-turn guidance with its user-facing display text', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: '{}'
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.steerUserMessage(
      'thr_1',
      'turn_1',
      'use the compact logo instead',
      { displayText: 'Use the compact logo instead' }
    )

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns/turn_1/steer',
      'POST',
      JSON.stringify({
        text: 'use the compact logo instead',
        displayText: 'Use the compact logo instead'
      })
    )
  })

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
              subagents: { status: 'disabled', enabled: false, available: false, maxParallel: 0, maxChildRuns: 0 },
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

  it('maps Kun SSE deltas into the thread event sink', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(() => ac.abort()),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              {
                kind: 'assistant_text_delta',
                seq: 3,
                item: {
                  id: 'item_text',
                  turnId: 'turn_1',
                  threadId: 'thr_1',
                  role: 'assistant',
                  status: 'running',
                  createdAt: 't1',
                  kind: 'assistant_text',
                  text: 'he'
                }
              }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 2, sink, ac.signal)
    expect(sink.onSeq).toHaveBeenCalledWith(3)
    expect(sink.onDeltas).toHaveBeenCalledWith([{ text: 'he', kind: 'agent_message', seq: 3 }])
  })

  it('acknowledges an SSE batch only after dispatching it and then advances the cursor', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    let releaseAck: (() => void) | undefined
    const ackGate = new Promise<void>((resolve) => {
      releaseAck = resolve
    })
    const ackSse = vi.fn(async () => {
      await ackGate
      return true
    })
    const startSse = vi.fn(async (_threadId: string, _sinceSeq: number, streamId?: string) => {
      queueMicrotask(() => {
        onData?.({
          streamId: streamId ?? 'stream-1',
          batchId: 'batch_1',
          events: [{ kind: 'assistant_text_delta', seq: 4, item: {
            id: 'item_text', turnId: 'turn_1', threadId: 'thr_1', role: 'assistant',
            status: 'running', createdAt: 't1', kind: 'assistant_text', text: 'ack me'
          } }]
        })
      })
      return { streamId: streamId ?? 'stream-1' }
    })
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse
    })
    const provider = new KunRuntimeProvider()
    const subscription = provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)

    await vi.waitFor(() => expect(sink.onDeltas).toHaveBeenCalledTimes(1))
    expect(ackSse).toHaveBeenCalledWith(expect.any(String), 'batch_1')
    expect(startSse).toHaveBeenCalledWith(
      'thr_1',
      0,
      expect.any(String),
      { acknowledgedBatches: true }
    )
    expect(sink.onSeq).not.toHaveBeenCalled()

    releaseAck?.()
    await vi.waitFor(() => expect(sink.onSeq).toHaveBeenCalledWith(4))
    ac.abort()
    await subscription
  })

  it('does not acknowledge or advance an SSE batch aborted during dispatch', async () => {
    let onData: ((payload: { streamId: string; events: unknown[]; batchId?: string }) => void) | null = null
    const ackSse = vi.fn(async () => true)
    const stopSse = vi.fn(async () => true)
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(() => ac.abort()),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(),
      onError: vi.fn()
    }
    installDsGui({
      ackSse,
      stopSse,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            batchId: 'batch_abort',
            events: [{ kind: 'assistant_text_delta', seq: 5, item: {
              id: 'item_text', turnId: 'turn_1', threadId: 'thr_1', role: 'assistant',
              status: 'running', createdAt: 't1', kind: 'assistant_text', text: 'abort me'
            } }]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()

    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)

    expect(ackSse).not.toHaveBeenCalled()
    expect(sink.onSeq).not.toHaveBeenCalled()
    expect(stopSse).toHaveBeenCalled()
  })

  it('auto-approves approval requests when policy is auto', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const resolveKunApproval = vi.fn(async () => ({
      confirmed: true as const,
      response: { ok: true, status: 200, body: '{}' }
    }))
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(() => ac.abort()),
      onError: vi.fn()
    }
    const autoSettings: AppSettingsV1 = {
      ...settings(),
      agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: 'auto' } }
    }
    installDsGui({
      getSettings: vi.fn(async () => autoSettings),
      runtimeRequest,
      resolveKunApproval,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              { kind: 'approval_requested', seq: 4, approvalId: 'appr_auto', summary: 'Need approval' },
              { kind: 'turn_completed', seq: 5 }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
    expect(resolveKunApproval).toHaveBeenCalledWith({
      approvalId: 'appr_auto',
      decision: 'allow',
      source: 'policy'
    })
    expect(sink.onApproval).not.toHaveBeenCalled()
  })

  it('uses the approval policy from runtime events before falling back to settings', async () => {
    let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
    const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
    const resolveKunApproval = vi.fn(async () => ({
      confirmed: true as const,
      response: { ok: true, status: 200, body: '{}' }
    }))
    const getSettings = vi.fn(async (): Promise<AppSettingsV1> => ({
      ...settings(),
      agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: 'on-request' } }
    }))
    const ac = new AbortController()
    const sink: ThreadEventSink = {
      onSeq: vi.fn(),
      onDeltas: vi.fn(),
      onUserMessage: vi.fn(),
      onTool: vi.fn(),
      onCompaction: vi.fn(),
      onApproval: vi.fn(),
      onUserInput: vi.fn(),
      onUserInputStatus: vi.fn(),
      onGoal: vi.fn(),
      onTodos: vi.fn(),
      onTurnComplete: vi.fn(() => ac.abort()),
      onError: vi.fn()
    }
    installDsGui({
      getSettings,
      runtimeRequest,
      resolveKunApproval,
      onSseEvent: vi.fn((handler) => {
        onData = handler
        return () => undefined
      }),
      startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
        queueMicrotask(() => {
          onData?.({
            streamId: streamId ?? 'stream-1',
            events: [
              {
                kind: 'approval_requested',
                seq: 4,
                approvalId: 'appr_event_auto',
                approvalPolicy: 'auto',
                summary: 'Need approval'
              },
              { kind: 'turn_completed', seq: 5 }
            ]
          })
        })
        return { streamId: streamId ?? 'stream-1' }
      })
    })
    const provider = new KunRuntimeProvider()
    await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
    expect(resolveKunApproval).toHaveBeenCalledWith({
      approvalId: 'appr_event_auto',
      decision: 'allow',
      source: 'policy'
    })
    expect(getSettings).not.toHaveBeenCalled()
    expect(sink.onApproval).not.toHaveBeenCalled()
  })

  it('renders approval cards for suggest and untrusted policies', async () => {
    for (const policy of ['suggest', 'untrusted'] as const) {
      let onData: ((payload: { streamId: string; events: unknown[] }) => void) | null = null
      const runtimeRequest = vi.fn(async () => ({ ok: true, status: 200, body: '{}' }))
      const resolveKunApproval = vi.fn(async () => ({
        confirmed: true as const,
        response: { ok: true, status: 200, body: '{}' }
      }))
      const ac = new AbortController()
      const sink: ThreadEventSink = {
        onSeq: vi.fn(),
        onDeltas: vi.fn(),
        onUserMessage: vi.fn(),
        onTool: vi.fn(),
        onCompaction: vi.fn(),
        onApproval: vi.fn(),
        onUserInput: vi.fn(),
        onUserInputStatus: vi.fn(),
        onGoal: vi.fn(),
        onTodos: vi.fn(),
        onTurnComplete: vi.fn(() => ac.abort()),
        onError: vi.fn()
      }
      const policySettings: AppSettingsV1 = {
        ...settings(),
        agents: { kun: { ...defaultKunRuntimeSettings(), approvalPolicy: policy } }
      }
      installDsGui({
        getSettings: vi.fn(async () => policySettings),
        runtimeRequest,
        resolveKunApproval,
        onSseEvent: vi.fn((handler) => {
          onData = handler
          return () => undefined
        }),
        startSse: vi.fn(async (_threadId, _sinceSeq, streamId) => {
          queueMicrotask(() => {
            onData?.({
              streamId: streamId ?? 'stream-1',
              events: [
                {
                  kind: 'approval_requested',
                  seq: 6,
                  approvalId: `appr_${policy}`,
                  summary: `${policy} approval`
                },
                { kind: 'turn_completed', seq: 7 }
              ]
            })
          })
          return { streamId: streamId ?? 'stream-1' }
        })
      })
      const provider = new KunRuntimeProvider()
      await provider.subscribeThreadEvents('thr_1', 0, sink, ac.signal)
      expect(sink.onApproval).toHaveBeenCalledWith({
        approvalId: `appr_${policy}`,
        summary: `${policy} approval`,
        toolName: undefined
      })
      expect(resolveKunApproval).not.toHaveBeenCalled()
    }
  })
})

describe('registry', () => {
  it('returns a cached provider for the kun id', () => {
    resetProviderCacheForTests()
    const first = getProvider()
    const second = getProvider()
    expect(first).toBe(second)
  })

})
