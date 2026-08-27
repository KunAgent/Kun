/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'

const prewarmMock = vi.hoisted(() => ({ requestThreadPrewarm: vi.fn() }))

vi.mock('../../store/thread-detail-prewarm', () => prewarmMock)
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

import { ThreadRow } from './SidebarProjectRows'

function setReactActEnvironment(value: boolean): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = value
}

function thread(): NormalizedThread {
  return {
    id: 'thread-ready',
    title: 'Ready conversation',
    updatedAt: '2026-08-23T00:00:00.000Z',
    model: 'deepseek-chat',
    mode: 'agent',
    status: 'idle'
  }
}

describe('SidebarProjectRows thread prewarm intent', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setReactActEnvironment(true)
    prewarmMock.requestThreadPrewarm.mockReset()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    setReactActEnvironment(false)
  })

  it('prioritizes a conversation when its row is hovered or keyboard-focused', async () => {
    const target = thread()
    await act(async () => {
      root.render(createElement(ThreadRow, {
        thread: target,
        active: false,
        deleting: false,
        locale: 'en',
        showRunning: false,
        showUnread: false,
        onSelect: vi.fn(),
        onContextMenu: vi.fn(),
        onPreviewOpen: vi.fn(),
        onPreviewClose: vi.fn(),
        onPin: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onDelete: vi.fn(),
        onRestore: vi.fn()
      }))
    })

    const row = container.querySelector<HTMLDivElement>('.ds-sidebar-tree-row')
    const button = row?.querySelector<HTMLButtonElement>('button')
    expect(row).not.toBeNull()
    expect(button).not.toBeNull()

    await act(async () => {
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(prewarmMock.requestThreadPrewarm).toHaveBeenLastCalledWith(target)

    await act(async () => button?.focus())
    expect(prewarmMock.requestThreadPrewarm).toHaveBeenCalledTimes(2)
  })

  it('does not reload the conversation that is already active', async () => {
    await act(async () => {
      root.render(createElement(ThreadRow, {
        thread: thread(),
        active: true,
        deleting: false,
        locale: 'en',
        showRunning: false,
        showUnread: false,
        onSelect: vi.fn(), onContextMenu: vi.fn(), onPreviewOpen: vi.fn(),
        onPreviewClose: vi.fn(), onPin: vi.fn(), onRename: vi.fn(),
        onArchive: vi.fn(), onDelete: vi.fn(), onRestore: vi.fn()
      }))
    })

    const row = container.querySelector<HTMLDivElement>('.ds-sidebar-tree-row')
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      row?.querySelector<HTMLButtonElement>('button')?.focus()
    })
    expect(prewarmMock.requestThreadPrewarm).not.toHaveBeenCalled()
  })
})
