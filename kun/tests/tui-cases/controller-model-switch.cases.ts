import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ThreadSchema } from '../../src/contracts/threads.js'
import type { ModelConnectionSnapshot } from '../../src/contracts/model-connections.js'
import type { KunTuiClient, ThreadDetail, TuiConnection } from '../../src/tui/client.js'
import { currentModel } from '../../src/tui/chat-format.js'
import { TuiController } from '../../src/tui/controller.js'
import type { TuiKeymap } from '../../src/tui/keymap.js'
import type { TuiOptions } from '../../src/tui/options.js'
import { ModelPage } from '../../src/tui/pages/model-page.js'

function detail(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    ...ThreadSchema.parse({
      id: 'thr_1',
      title: 'Greeting',
      workspace: '/tmp/project',
      providerId: 'deepseek',
      accountId: 'account:deepseek',
      model: 'deepseek-flash',
      mode: 'agent',
      status: 'idle',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      relation: 'primary',
      createdAt: '2026-10-20T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
      turns: []
    }),
    latestSeq: 0,
    pendingUserInputIds: [],
    ...overrides
  }
}

function snapshot(revision: number, defaultProviderId: 'deepseek' | 'codex'): ModelConnectionSnapshot {
  const defaultModel = defaultProviderId === 'codex' ? 'gpt-6-luna' : 'deepseek-flash'
  return {
    schemaVersion: 1,
    proxyRoutingVersion: 1,
    revision,
    providers: [
      {
        id: 'deepseek',
        accountId: 'account:deepseek',
        name: 'DeepSeek',
        kind: 'http',
        authType: 'api-key',
        endpointFormat: 'chat_completions',
        useProxy: false,
        configured: true,
        models: ['deepseek-flash'],
        selectedModel: 'deepseek-flash'
      },
      {
        id: 'codex',
        accountId: 'account:codex',
        name: 'Codex',
        kind: 'http',
        authType: 'subscription',
        endpointFormat: 'responses',
        useProxy: false,
        configured: true,
        models: ['gpt-6-luna'],
        selectedModel: 'gpt-6-luna'
      }
    ],
    defaultProviderId,
    defaultAccountId: `account:${defaultProviderId}`,
    defaultModel,
    proxy: { enabled: false, url: '' },
    routePools: [],
    failover: [],
    localModelGateway: { enabled: false, exposeProviderModels: false }
  }
}

const codex = { providerId: 'codex', accountId: 'account:codex', model: 'gpt-6-luna' }

const runtime = {
  baseUrl: 'http://127.0.0.1:18899',
  runtimeToken: 'secret',
  discovered: true,
  runtimeInfo: { model: 'deepseek-flash', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' }
} as unknown as TuiConnection

const keymap = { display: () => 'x', matches: () => false } as unknown as TuiKeymap

async function harness(input: { threads?: ThreadDetail[]; options?: Partial<TuiOptions> } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'kun-tui-model-switch-'))
  const threads = input.threads ?? [detail()]
  const client = {
    listThreads: vi.fn(async () => threads),
    getThread: vi.fn(async (id: string) => threads.find((thread) => thread.id === id)!),
    subscribeThreadEvents: vi.fn(async (request: { signal: AbortSignal }) => {
      await new Promise<void>((resolve) =>
        request.signal.addEventListener('abort', () => resolve(), { once: true }))
    }),
    selectModel: vi.fn(async () => snapshot(2, 'codex')),
    startTurn: vi.fn(async () => ({ turnId: 'turn_next' })),
    createThread: vi.fn(async (request: Partial<ThreadDetail>) => detail({ id: 'thr_new', ...request }))
  }
  const tuiOptions: TuiOptions = {
    runtimeToken: 'secret',
    dataDir,
    workspace: '/tmp/project',
    continueLatest: true,
    noStart: false,
    help: false,
    ...input.options
  }
  const controller = new TuiController(client as unknown as KunTuiClient, tuiOptions, runtime)
  return {
    client,
    controller,
    tuiOptions,
    cleanup: async () => {
      await controller.stop()
      await rm(dataDir, { recursive: true, force: true })
    }
  }
}

describe('TuiController explicit model switch', () => {
  it('retargets the open session so the footer and the next turn use the /model pick', async () => {
    const { client, controller, cleanup } = await harness()
    try {
      await controller.start()
      controller.applyModelSelection(snapshot(1, 'deepseek'), false)
      expect(currentModel(controller.state, controller)).toBe('deepseek / deepseek-flash')

      await controller.selectModel(codex)

      expect(currentModel(controller.state, controller)).toBe('codex / gpt-6-luna')
      expect(controller.activeModelSelection()).toEqual(codex)
      expect(controller.state.notification).toMatchObject({ kind: 'info', message: 'Model: codex/gpt-6-luna' })
      await controller.submit('next')
      expect(client.startTurn).toHaveBeenCalledWith('thr_1', expect.objectContaining(codex))
    } finally {
      await cleanup()
    }
  })

  it('keeps an unsent pick when the session is reopened before its next turn', async () => {
    const other = detail({ id: 'thr_2', title: 'Other' })
    const { controller, cleanup } = await harness({ threads: [detail(), other] })
    try {
      await controller.start()
      controller.applyModelSelection(snapshot(1, 'deepseek'), false)
      await controller.selectModel(codex)

      await controller.openThread('thr_2')
      expect(controller.activeModelSelection().model).toBe('deepseek-flash')
      await controller.openThread('thr_1')
      expect(controller.activeModelSelection()).toEqual(codex)
    } finally {
      await cleanup()
    }
  })

  it('lets /model replace launch-time model flags for new sessions', async () => {
    const { client, controller, tuiOptions, cleanup } = await harness({
      threads: [],
      options: { continueLatest: false, providerId: 'deepseek', accountId: 'account:deepseek', model: 'deepseek-flash' }
    })
    try {
      await controller.start()
      controller.applyModelSelection(snapshot(1, 'deepseek'), false)

      await controller.selectModel(codex)

      expect(tuiOptions).toMatchObject(codex)
      expect(controller.state.notification).toMatchObject({ message: 'Default model: codex/gpt-6-luna' })
      await controller.createThread('Fresh')
      expect(client.createThread).toHaveBeenCalledWith(expect.objectContaining(codex))
    } finally {
      await cleanup()
    }
  })

  it('marks the open session model as current while another client changes the default', async () => {
    const { controller, cleanup } = await harness()
    try {
      await controller.start()
      controller.applyModelSelection(snapshot(1, 'deepseek'), false)
      controller.applyModelSelection(snapshot(2, 'codex'))

      expect(controller.state.notification).toMatchObject({
        message: 'Default model for new sessions: codex/gpt-6-luna'
      })
      const page = new ModelPage(controller, keymap, snapshot(2, 'codex'), () => undefined, () => undefined)
      const view = page.view({ width: 100, height: 30 })
      expect(view.right).toBe('Current · deepseek / deepseek-flash')
      expect(view.description).toBe('Choose the model for this session and new sessions.')
    } finally {
      await cleanup()
    }
  })
})
