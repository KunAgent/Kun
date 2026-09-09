import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getProvider, resetProviderCacheForTests } from '../agent/registry'
import { installDsGui } from '../agent/kun-runtime-test-support'
import { useChatStore } from '../store/chat-store'
import { ArchivedThreadsSettingsSection } from './settings-section-archives'

vi.mock('../lib/confirm-dialog', () => ({ confirmDialog: vi.fn(async () => true) }))

const labels: Record<string, string> = {
  archivesCount: '{{count}} archived',
  archivesEmpty: 'No archived chats yet.',
  archivesRestore: 'Restore',
  archivesDelete: 'Delete archived chat',
  loading: 'Loading',
  refresh: 'Refresh'
}
const t = (key: string, options?: Record<string, unknown>): string =>
  (labels[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))

function archived(id: number) {
  return {
    id: `archive-${id}`,
    title: `Archived conversation ${id}`,
    status: 'archived',
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    workspace: id % 2 === 0 ? 'C:\\Projects\\one' : 'D:\\Projects\\two',
    model: 'deepseek-chat',
    mode: 'agent'
  }
}

function response(body: unknown) {
  return { ok: true, status: 200, body: JSON.stringify(body) }
}

let renderer: ReactTestRenderer | undefined

function context() {
  return {
    t, tCommon: t, locale: 'en', runtimeReady: true,
    // The active sidebar inventory contains no archived chats after a restart.
    threads: [{ ...archived(100), status: 'idle', archived: false }],
    refreshThreads: vi.fn(async () => undefined),
    archiveThread: vi.fn((id: string, value: boolean) => getProvider().archiveThread!(id, value)),
    deleteThread: vi.fn((id: string) => getProvider().deleteThread(id))
  }
}

async function mount(ctx = context()) {
  await act(async () => {
    renderer = create(createElement(ArchivedThreadsSettingsSection, { ctx }))
  })
  return ctx
}

function textContent(): string {
  return JSON.stringify(renderer!.toJSON())
}

async function refresh() {
  await act(async () => {
    renderer!.root.findAllByType('button').find((button) => button.props.title === 'Refresh')!.props.onClick()
  })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  resetProviderCacheForTests()
})

afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('archived settings inventory', () => {
  it('loads all 47 archives across pages independently of the active sidebar (#1302)', async () => {
    const inventory = Array.from({ length: 47 }, (_, id) => archived(id))
    const runtimeRequest = vi.fn(async (path: string) => {
      const query = new URL(path, 'http://localhost').searchParams
      expect(query.get('archived_only')).toBe('true')
      expect(query.has('workspace')).toBe(false)
      expect(query.has('search')).toBe(false)
      expect(query.has('include')).toBe(false)
      expect(query.get('lean')).toBe('1')
      return query.has('cursor')
        ? response({ threads: inventory.slice(25), hasMore: false })
        : response({ threads: inventory.slice(0, 25), hasMore: true, nextCursor: 'archive-page-2' })
    })
    installDsGui({ runtimeRequest })
    const ctx = await mount()

    expect(textContent()).toContain('47 archived')
    for (const item of inventory) expect(textContent()).toContain(item.title)
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
    expect(runtimeRequest.mock.calls[1][0]).toContain('cursor=archive-page-2')
    expect(ctx.refreshThreads).not.toHaveBeenCalled()

    await act(async () => {
      renderer!.update(createElement(ArchivedThreadsSettingsSection, { ctx: { ...ctx, threads: [] } }))
    })
    expect(textContent()).toContain('47 archived')
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
  })

  it('restores and deletes archives absent from the sidebar, then reloads the archive inventory', async () => {
    let inventory = [archived(1), archived(2)]
    const runtimeRequest = vi.fn(async (path: string, method?: string, body?: string) => {
      if (method === 'PATCH' || method === 'DELETE') {
        if (method === 'PATCH') expect(JSON.parse(body!)).toEqual({ status: 'idle' })
        inventory = inventory.filter((item) => !path.endsWith(`/${item.id}`))
        return response({})
      }
      return response({ threads: inventory })
    })
    installDsGui({ runtimeRequest })
    const ctx = await mount()
    await act(async () => {
      renderer!.root.findAllByType('button').find((button) => button.children.includes('Restore'))!.props.onClick()
    })
    expect(ctx.archiveThread).toHaveBeenCalledWith('archive-2', false)
    expect(textContent()).toContain('1 archived')
    expect(textContent()).not.toContain('Archived conversation 2')

    await act(async () => {
      renderer!.root.findByProps({ 'aria-label': 'Delete archived chat' }).props.onClick()
    })
    expect(ctx.deleteThread).toHaveBeenCalledWith('archive-1')
    expect(textContent()).toContain('0 archived')
    expect(textContent()).toContain('No archived chats yet.')
  })

  it('provides archive metadata before opening a conversation absent from the sidebar', async () => {
    installDsGui({ runtimeRequest: vi.fn(async () => response({ threads: [archived(1)] })) })
    const initialThreads = useChatStore.getState().threads
    const active = context().threads
    const openCode = vi.fn(async () => undefined)
    const selectThread = vi.fn(async (id: string) => {
      expect(openCode).toHaveBeenCalledOnce()
      expect(useChatStore.getState().threads.find((thread) => thread.id === id)).toMatchObject({
        title: 'Archived conversation 1', archived: true, workspace: 'D:/Projects/two'
      })
    })
    try {
      useChatStore.setState({ threads: active })
      const ctx = { ...context(), openCode, selectThread }
      await mount(ctx)
      await act(async () => {
        renderer!.root.findAllByType('button').find((button) =>
          button.findAllByType('div').some((div) => div.children.includes('Archived conversation 1'))
        )!.props.onClick()
      })
      expect(selectThread).toHaveBeenCalledWith('archive-1')
      expect(useChatStore.getState().threads).toContain(active[0])
    } finally {
      useChatStore.setState({ threads: initialThreads })
    }
  })

  it('keeps loading and retries while the cold thread index is rebuilding', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce(response({ threads: [], indexStatus: { status: 'running', indexed: 0, total: 47 } }))
      .mockResolvedValue(response({ threads: [archived(1)], indexStatus: { status: 'ready', indexed: 47, total: 47 } }))
    installDsGui({ runtimeRequest })
    await mount()
    expect(textContent()).toContain('Loading')
    expect(textContent()).not.toContain('No archived chats yet.')

    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(textContent()).toContain('Archived conversation 1')
    expect(textContent()).not.toContain('Loading')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(runtimeRequest).toHaveBeenCalledTimes(2)
  })

  it('shows a retryable load error instead of claiming that no archives exist', async () => {
    const runtimeRequest = vi.fn()
      .mockRejectedValueOnce(new Error('Archive list unavailable'))
      .mockResolvedValue(response({ threads: [archived(1)] }))
    installDsGui({ runtimeRequest })
    await mount()
    expect(textContent()).toContain('Archive list unavailable')
    expect(textContent()).not.toContain('No archived chats yet.')
    await refresh()
    expect(textContent()).toContain('Archived conversation 1')
    expect(textContent()).not.toContain('Archive list unavailable')
  })

  it('preserves the last archive inventory when a refresh fails', async () => {
    const runtimeRequest = vi.fn()
      .mockResolvedValueOnce(response({ threads: [archived(1)] }))
      .mockRejectedValue(new Error('Archive list unavailable'))
    installDsGui({ runtimeRequest })
    await mount()
    await refresh()
    expect(textContent()).toContain('Archived conversation 1')
    expect(textContent()).toContain('Archive list unavailable')
  })

  it('keeps an archive visible and reports a failed restore', async () => {
    installDsGui({ runtimeRequest: vi.fn(async () => response({ threads: [archived(1)] })) })
    const ctx = context()
    ctx.archiveThread.mockRejectedValue(new Error('Restore failed'))
    await mount(ctx)
    await act(async () => {
      renderer!.root.findAllByType('button').find((button) => button.children.includes('Restore'))!.props.onClick()
    })
    expect(textContent()).toContain('Archived conversation 1')
    expect(textContent()).toContain('Restore failed')
  })

  it('ignores an older in-flight inventory after a newer refresh completes', async () => {
    let resolveFirst!: (value: ReturnType<typeof response>) => void
    const runtimeRequest = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValue(response({ threads: [archived(2)] }))
    installDsGui({ runtimeRequest })
    await mount()
    expect(textContent()).toContain('Loading')
    expect(textContent()).not.toContain('No archived chats yet.')
    await refresh()
    await act(async () => resolveFirst(response({ threads: [archived(1)] })))
    expect(textContent()).toContain('Archived conversation 2')
    expect(textContent()).not.toContain('Archived conversation 1')
  })

  it('stops cold-index polling when the archive page closes', async () => {
    vi.useFakeTimers()
    const runtimeRequest = vi.fn(async () => response({
      threads: [], indexStatus: { status: 'running', indexed: 0, total: 47 }
    }))
    installDsGui({ runtimeRequest })
    await mount()
    await act(async () => renderer!.unmount())
    renderer = undefined
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(runtimeRequest).toHaveBeenCalledTimes(1)
  })

  it('waits for the runtime to reconnect before loading archives', async () => {
    const runtimeRequest = vi.fn(async () => response({ threads: [archived(1)] }))
    installDsGui({ runtimeRequest })
    const ctx = { ...context(), runtimeReady: false }
    await mount(ctx)
    expect(runtimeRequest).not.toHaveBeenCalled()
    await act(async () => {
      renderer!.update(createElement(ArchivedThreadsSettingsSection, { ctx: { ...ctx, runtimeReady: true } }))
    })
    expect(textContent()).toContain('Archived conversation 1')
  })
})
