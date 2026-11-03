import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_ATTENTION_CHANNEL } from '../shared/user-attention'

type Handler = (event: unknown, payload: unknown) => Promise<unknown>

const state = vi.hoisted(() => ({
  setBadgeCount: vi.fn((count: number) => count >= 0),
  bounce: vi.fn(),
  supported: true,
  notifications: [] as Array<{ title: string; body: string }>,
  handler: null as Handler | null
}))

vi.mock('electron', () => ({
  app: { setBadgeCount: state.setBadgeCount, dock: { bounce: state.bounce } },
  Notification: class {
    static isSupported(): boolean {
      return state.supported
    }
    title: string
    body: string
    constructor(options: { title: string; body: string }) {
      this.title = options.title
      this.body = options.body
      state.notifications.push(this)
    }
    on(): void {}
  },
  ipcMain: {
    handle: (_channel: string, handler: Handler) => {
      state.handler = handler
    }
  }
}))

vi.mock('./ipc/app-ipc-handler-utils', () => ({
  assertTrustedWorkbenchSender: () => undefined,
  parseIpcPayload: (_channel: string, schema: { parse: (value: unknown) => unknown }, payload: unknown) =>
    schema.parse(payload)
}))

vi.mock('./notification-display', () => ({
  displayNotification: async () => ({ ok: true, shown: true })
}))

const originalPlatform = process.platform

async function loadModule(): Promise<typeof import('./user-attention')> {
  vi.resetModules()
  return import('./user-attention')
}

const request = { key: 'assistant:cue', title: 'Done', body: 'Review the task', badge: 1 }

describe('user attention badge', () => {
  beforeEach(() => {
    state.setBadgeCount.mockClear()
    state.bounce.mockClear()
    state.notifications.length = 0
    state.supported = true
    state.handler = null
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('applies only the renderer attention count', async () => {
    const { applyAppBadge } = await loadModule()
    expect(applyAppBadge(4)).toBe(true)
    expect(state.setBadgeCount).toHaveBeenCalledWith(4)
  })

  it('keeps the unified count when another surface asks for attention', async () => {
    const { applyAppBadge, registerUserAttentionIpc } = await loadModule()
    registerUserAttentionIpc(() => null)
    applyAppBadge(2)
    state.setBadgeCount.mockClear()

    await state.handler!(null, { ...request, badge: 9 })

    expect(state.setBadgeCount).not.toHaveBeenCalled()
  })

  it('ignores zero-badge requests beyond clearing notification memory', async () => {
    const { applyAppBadge, registerUserAttentionIpc } = await loadModule()
    registerUserAttentionIpc(() => null)
    applyAppBadge(3)
    state.setBadgeCount.mockClear()

    const result = await state.handler!(null, { ...request, badge: 0 })

    expect(result).toEqual({ shown: false })
    expect(state.setBadgeCount).not.toHaveBeenCalled()
    expect(state.bounce).not.toHaveBeenCalled()
    expect(state.notifications).toHaveLength(0)
  })

  it('still shows one OS notification per key and bounces the dock', async () => {
    const { registerUserAttentionIpc } = await loadModule()
    registerUserAttentionIpc(() => null)

    await expect(state.handler!(null, request)).resolves.toEqual({ shown: true })
    await expect(state.handler!(null, request)).resolves.toEqual({ shown: false })

    expect(state.notifications).toHaveLength(1)
    expect(state.bounce).toHaveBeenCalledTimes(2)
  })
})
