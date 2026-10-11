// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useReviewStore } from '../../store/review-store'
import { AdeWorkspaceProjectPicker } from './AdeWorkspaceProjectPicker'

let host: HTMLDivElement
let root: Root
const original = useChatStore.getState()

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useChatStore.setState({
    codeWorkspaceRoots: ['/repo/alpha', '/repo/beta'],
    selectAdeWorkspaceRoot: vi.fn(async (path: string) => path),
    chooseAdeWorkspace: vi.fn(async () => '/repo/new')
  })
  useReviewStore.setState({ bindings: {} })
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  document.body.innerHTML = ''
  useChatStore.setState(original)
  useReviewStore.setState({ bindings: {} })
})

async function renderPicker(props: Partial<Parameters<typeof AdeWorkspaceProjectPicker>[0]> = {}): Promise<void> {
  await act(async () => root.render(createElement(AdeWorkspaceProjectPicker, {
    workspaceRoot: '/repo/alpha', activeThreadId: null, ...props
  })))
}

async function openMenu(): Promise<HTMLElement> {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-ade-workspace-trigger]')!.click())
  return document.body.querySelector<HTMLElement>('[data-ade-workspace-menu]')!
}

describe('AdeWorkspaceProjectPicker', () => {
  it('shows the shared project catalog and selects another project through the ADE action', async () => {
    await renderPicker()
    const menu = await openMenu()
    expect(menu.querySelector('[data-ade-project-root="/repo/alpha"]')).toBeTruthy()
    await act(async () => {
      menu.querySelector<HTMLButtonElement>('[data-ade-project-root="/repo/beta"]')!.click()
    })
    expect(useChatStore.getState().selectAdeWorkspaceRoot).toHaveBeenCalledWith('/repo/beta')
    expect(document.body.querySelector('[data-ade-workspace-menu]')).toBeNull()
  })

  it('does not reset selection when the same project is chosen', async () => {
    await renderPicker()
    const menu = await openMenu()
    await act(async () => {
      menu.querySelector<HTMLButtonElement>('[data-ade-project-root="/repo/alpha"]')!.click()
    })
    expect(useChatStore.getState().selectAdeWorkspaceRoot).not.toHaveBeenCalled()
  })

  it('keeps the menu open after a canceled directory dialog', async () => {
    const choose = vi.fn(async () => null)
    useChatStore.setState({ chooseAdeWorkspace: choose })
    await renderPicker()
    const menu = await openMenu()
    await act(async () => menu.querySelector<HTMLButtonElement>('[data-ade-project-browse]')!.click())
    expect(choose).toHaveBeenCalledTimes(1)
    expect(document.body.querySelector('[data-ade-workspace-menu]')).toBeTruthy()
  })

  it('shows a bound worktree source and actual execution path, but blocks switching while queued', async () => {
    await renderPicker({
      activeThreadId: 'thread-1',
      threadWorkspaceRoot: '/tasks/one',
      threadTaskWorkspaceId: 'workspace-1',
      prep: { workspaceId: 'workspace-1', ownerThreadId: 'thread-1', state: 'ready', sourceRoot: '/repo/alpha', path: '/tasks/one' },
      disabledReason: 'Messages are queued'
    })
    const trigger = host.querySelector<HTMLButtonElement>('[data-ade-workspace-trigger]')!
    expect(trigger.textContent).toContain('alpha')
    expect(trigger.title).toContain('/repo/alpha')
    expect(trigger.title).toContain('/tasks/one')
    const menu = await openMenu()
    expect(menu.textContent).toContain('Messages are queued')
    expect(menu.querySelector<HTMLButtonElement>('[data-ade-project-root="/repo/beta"]')!.disabled).toBe(true)
    expect(menu.querySelector<HTMLButtonElement>('[data-ade-project-browse]')!.disabled).toBe(true)
  })
})
