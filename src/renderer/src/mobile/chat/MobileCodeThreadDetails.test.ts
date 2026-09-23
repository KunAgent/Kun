// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MobileCodeThreadDetails } from './MobileCodeThreadDetails'

const state = vi.hoisted(() => ({
  threads: [
    { id: 't-1', title: 'Alpha task', workspace: '/projects/alpha', updatedAt: '', model: '' }
  ],
  composerMode: 'auto', composerModel: '',
  renameThread: vi.fn(async () => undefined),
  archiveThread: vi.fn(async () => undefined)
}))
vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state }
  )
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => undefined }
}))
vi.mock('../sheets/MobileSheet', () => ({
  MobileSheet: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? createElement('div', { className: 'sheet' }, children) : null
}))

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  vi.clearAllMocks()
  state.threads = [
    { id: 't-1', title: 'Alpha task', workspace: '/projects/alpha', updatedAt: '', model: '' }
  ]
  state.renameThread.mockImplementation(async () => undefined)
  state.archiveThread.mockImplementation(async () => undefined)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

function renderDetails(open: boolean, onArchived = vi.fn()): void {
  act(() => root.render(createElement(MobileCodeThreadDetails, {
    threadId: 't-1', open, onClose: vi.fn(), onArchived
  })))
}

function titleInput(): HTMLInputElement {
  return host.querySelector('input[type="text"]') as HTMLInputElement
}

function editTitle(value: string): void {
  const input = titleInput()
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('surfaces a rename failure instead of an unhandled rejection', async () => {
  state.renameThread.mockRejectedValue(new Error('rename refused'))
  renderDetails(true)
  act(() => { titleInput().dispatchEvent(new FocusEvent('focus')) })
  act(() => editTitle('New title'))
  await act(async () => {
    (host.querySelectorAll('button')[0] as HTMLButtonElement).click()
  })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('rename refused')
  // Still in edit mode so the user can retry or cancel.
  expect(titleInput().value).toBe('New title')
})

it('drops the draft and error when the sheet closes', async () => {
  state.renameThread.mockRejectedValue(new Error('nope'))
  renderDetails(true)
  act(() => { titleInput().dispatchEvent(new FocusEvent('focus')) })
  act(() => editTitle('Draft title'))
  await act(async () => {
    (host.querySelectorAll('button')[0] as HTMLButtonElement).click()
  })
  expect(host.querySelector('[role="alert"]')).toBeTruthy()
  renderDetails(false)
  renderDetails(true)
  // Reopened sheet shows the stored title, not the failed draft or edit mode.
  expect(titleInput().value).toBe('Alpha task')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.textContent).not.toContain('mobileSave')
})

it('does not call onArchived when archiving fails', async () => {
  const onArchived = vi.fn()
  state.archiveThread.mockRejectedValue(new Error('archive refused'))
  renderDetails(true, onArchived)
  const archiveButton = [...host.querySelectorAll('button')].find((button) =>
    button.textContent === 'sidebarThreadArchive') as HTMLButtonElement
  await act(async () => { archiveButton.click() })
  expect(state.archiveThread).toHaveBeenCalledWith('t-1', true)
  expect(onArchived).not.toHaveBeenCalled()
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('archive refused')
})
