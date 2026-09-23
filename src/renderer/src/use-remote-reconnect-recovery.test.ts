// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRemoteReconnectRecovery } from './use-remote-reconnect-recovery'
import { registerRemoteStreamResubscriber } from './lib/remote-stream-resubscribers'

const state = vi.hoisted(() => ({
  runtimeConnection: 'ready' as string,
  activeThreadId: 'thread-1' as string | null,
  probeRuntime: vi.fn(async () => undefined),
  refreshThreads: vi.fn(async () => undefined),
  recoverActiveTurn: vi.fn(async () => true)
}))

vi.mock('./store/chat-store', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
}))

type Handler = () => void
const handlers = vi.hoisted(() => new Map<string, Handler[]>())

function onEvent(channel: string) {
  return (handler: Handler) => {
    const list = handlers.get(channel) ?? []
    list.push(handler)
    handlers.set(channel, list)
    return () => {
      const index = list.indexOf(handler)
      if (index >= 0) list.splice(index, 1)
    }
  }
}

function emit(channel: string): void {
  for (const handler of [...(handlers.get(channel) ?? [])]) handler()
}

function setKunGui(value: unknown): void {
  ;(window as unknown as { kunGui: unknown }).kunGui = value
}

function bridge(isRemoteWeb: boolean) {
  return {
    isRemoteWeb,
    onRemoteStreamReconnected: onEvent('remote:stream-reconnected'),
    onRemoteSenderReset: onEvent('remote:sender-reset')
  }
}

describe('useRemoteReconnectRecovery', () => {
  let root: Root | undefined
  let container: HTMLDivElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    handlers.clear()
    state.probeRuntime.mockClear()
    state.refreshThreads.mockClear()
    state.recoverActiveTurn.mockClear()
    state.runtimeConnection = 'ready'
    state.activeThreadId = 'thread-1'
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = undefined
    container.remove()
    delete (window as unknown as { kunGui?: unknown }).kunGui
  })

  function mount(): void {
    function Harness() {
      useRemoteReconnectRecovery()
      return null
    }
    root = createRoot(container)
    act(() => root!.render(createElement(Harness)))
  }

  it('is inert on desktop Electron', () => {
    setKunGui(bridge(false))
    mount()
    emit('remote:stream-reconnected')
    emit('remote:sender-reset')
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
  })

  it('performs a quiet check on remote:stream-reconnected without resubscribing streams', () => {
    setKunGui(bridge(true))
    mount()
    emit('remote:stream-reconnected')
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
  })

  it('resubscribes the active thread and registered streams on remote:sender-reset', () => {
    setKunGui(bridge(true))
    mount()
    const resubscribe = vi.fn()
    const off = registerRemoteStreamResubscriber(resubscribe)
    try {
      emit('remote:sender-reset')
      expect(state.refreshThreads).toHaveBeenCalledTimes(1)
      expect(state.recoverActiveTurn).toHaveBeenCalledWith({ reason: 'remote_sender_reset' })
      expect(resubscribe).toHaveBeenCalledTimes(1)
    } finally {
      off()
    }
  })

  it('re-probes the runtime instead of refreshing when the connection is not ready', () => {
    setKunGui(bridge(true))
    state.runtimeConnection = 'offline'
    mount()
    emit('remote:sender-reset')
    expect(state.probeRuntime).toHaveBeenCalledWith('background')
    expect(state.refreshThreads).not.toHaveBeenCalled()
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
  })

  it('runs a quiet check when a hidden page becomes visible again', () => {
    setKunGui(bridge(true))
    mount()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(state.refreshThreads).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(state.refreshThreads).toHaveBeenCalledTimes(1)
    expect(state.recoverActiveTurn).not.toHaveBeenCalled()
  })
})
