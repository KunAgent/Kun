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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS
      })
    )
    expect(result.userMessageItemId).toBe('item_user_real')
  })

  it('prefers queued per-turn execution settings over the global runtime settings', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_snapshot', userMessageItemId: 'item_snapshot' })
    }))
    installDsGui({ runtimeRequest })

    await new KunRuntimeProvider().sendUserMessage('thr_1', 'run queued turn', {
      clientRequestId: 'turn_client_snapshot',
      approvalPolicy: 'always',
      sandboxMode: 'read-only',
      approvalReviewer: 'agent'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'run queued turn',
        clientRequestId: 'turn_client_snapshot',
        clientSurface: 'gui',
        approvalPolicy: 'always',
        sandboxMode: 'read-only',
        approvalReviewer: 'agent'
      })
    )
  })

  it('forwards a client request id for retry-safe turn admission', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })

    await new KunRuntimeProvider().sendUserMessage('thr_1', 'hello', {
      clientRequestId: 'turn_client_1'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'hello',
        clientRequestId: 'turn_client_1',
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS
      })
    )
  })

  it('posts structured subagent resume metadata with its dedicated message source', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_resume', userMessageItemId: 'item_resume' })
    }))
    installDsGui({ runtimeRequest })

    await new KunRuntimeProvider().sendUserMessage('thr_1', 'fixed backend prompt', {
      clientRequestId: 'subagent-resume:2:child_1',
      displayText: 'Continue interrupted subagent',
      subagentResume: { childId: 'child_1', expectedResumeCount: 2 }
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'fixed backend prompt',
        clientRequestId: 'subagent-resume:2:child_1',
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
        subagentResume: { childId: 'child_1', expectedResumeCount: 2 },
        messageSource: 'subagent_resume',
        displayText: 'Continue interrupted subagent'
      })
    )
  })

  it('posts Design continuation metadata for runtime-auditable progress turns', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_logo', userMessageItemId: 'item_logo' })
    }))
    installDsGui({ runtimeRequest })

    await new KunRuntimeProvider().sendUserMessage('thr_1', 'internal logo prompt', {
      messageSource: 'design_continuation'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'internal logo prompt',
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
        messageSource: 'design_continuation'
      })
    )
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
        clientSurface: 'gui',
        model: 'mimo-v2.5',
        providerId: 'xiaomi-token-plan',
        ...DEFAULT_EXECUTION_SETTINGS
      })
    )
  })

  it('uses the configured Plan-mode model and provider when the turn has no explicit override', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_plan', userMessageItemId: 'item_plan' })
    }))
    installDsGui({
      runtimeRequest,
      getSettings: vi.fn(async () => ({
        ...settings(),
        agents: {
          kun: {
            ...defaultKunRuntimeSettings(),
            planModel: 'reasoning-pro',
            planProviderId: 'provider-pro'
          }
        }
      }))
    })
    await new KunRuntimeProvider().sendUserMessage('thr_1', 'draft a plan', { mode: 'plan' })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'draft a plan',
        clientSurface: 'gui',
        model: 'reasoning-pro',
        providerId: 'provider-pro',
        ...DEFAULT_EXECUTION_SETTINGS,
        mode: 'plan'
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
        workspaceCheckpointId: 'gcp_1'
      })
    )
  })

  it('posts pending checkpoint request ids without claiming rollback is ready', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_abc', userMessageItemId: 'item_user_real' })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()
    await provider.sendUserMessage('thr_1', 'hello', {
      workspaceCheckpointRequestId: 'gcp_pending_1'
    })
    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'hello',
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
        workspaceCheckpointRequestId: 'gcp_pending_1'
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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

  it('posts the selected model route and reasoning effort for reviews', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({
        threadId: 'thr_1',
        turnId: 'turn_review',
        userMessageItemId: 'item_user_review',
        reviewItemId: 'item_review'
      })
    }))
    installDsGui({ runtimeRequest })
    const provider = new KunRuntimeProvider()

    await provider.reviewThread('thr_1', { kind: 'uncommittedChanges' }, {
      model: 'gpt-5.6-terra',
      providerId: 'codex',
      accountId: 'account-1',
      reasoningEffort: 'max'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/review',
      'POST',
      JSON.stringify({
        target: { kind: 'uncommittedChanges' },
        model: 'gpt-5.6-terra',
        providerId: 'codex',
        accountId: 'account-1',
        reasoningEffort: 'max'
      })
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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
        clientSurface: 'gui',
        model: 'auto',
        ...DEFAULT_EXECUTION_SETTINGS,
        reasoningEffort: 'max'
      })
    )
  })

  it('posts the canonical priority service tier for Fast turns', async () => {
    const runtimeRequest = vi.fn(async () => ({
      ok: true,
      status: 202,
      body: JSON.stringify({ threadId: 'thr_1', turnId: 'turn_fast', userMessageItemId: 'item_user_fast' })
    }))
    installDsGui({ runtimeRequest })

    await new KunRuntimeProvider().sendUserMessage('thr_1', 'move faster', {
      model: 'gpt-5.4',
      providerId: 'codex-2',
      serviceTier: 'priority'
    })

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns',
      'POST',
      JSON.stringify({
        prompt: 'move faster',
        clientSurface: 'gui',
        model: 'gpt-5.4',
        providerId: 'codex-2',
        ...DEFAULT_EXECUTION_SETTINGS,
        serviceTier: 'priority'
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
        clientSurface: 'gui',
        ...DEFAULT_EXECUTION_SETTINGS,
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

  it('posts mid-turn guidance with display text and image attachment ids', async () => {
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
      {
        displayText: 'Use the compact logo instead',
        attachmentIds: ['att_0123456789abcdef01234567']
      }
    )

    expect(runtimeRequest).toHaveBeenCalledWith(
      '/v1/threads/thr_1/turns/turn_1/steer',
      'POST',
      JSON.stringify({
        text: 'use the compact logo instead',
        displayText: 'Use the compact logo instead',
        attachmentIds: ['att_0123456789abcdef01234567']
      })
    )
  })

})
