// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatState } from '../../store/chat-store-types'
import type { NormalizedThread } from '../../agent/types'
import i18n from '../../i18n'
import { useCodeProjectEditorStore } from '../../store/code-workspace-project-editor'
import { CodeWorkspaceProjectDialog } from './CodeWorkspaceProjectDialog'

const APP = '/Users/test/Code/app'
const API = '/Users/test/Code/api'
const fixture = vi.hoisted(() => ({
  state: {} as ChatState,
  save: vi.fn(),
  exists: vi.fn(),
  pick: vi.fn(),
  selectCode: vi.fn(),
  selectAde: vi.fn(),
  setState: vi.fn()
}))

vi.mock('../../store/chat-store', () => ({
  useChatStore: Object.assign((selector: (state: ChatState) => unknown) => selector(fixture.state), {
    getState: () => fixture.state,
    setState: fixture.setState
  })
}))
vi.mock('../../store/code-workspace-project-actions', () => ({
  submitCodeWorkspaceProjectDraft: fixture.save,
  codeProjectErrorMessage: (error: string) => error
}))
vi.mock('../../lib/workspace-availability', () => ({ workspaceDirectoryExists: fixture.exists }))
vi.mock('../../lib/native-dialog-activity', () => ({ withNativeDialog: (run: () => Promise<unknown>) => run() }))

let host: HTMLDivElement
let root: Root

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('kunGui', { pickWorkspaceDirectory: fixture.pick })
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
  await i18n.changeLanguage('en')
  useCodeProjectEditorStore.getState().close()
  fixture.state = {
    codeWorkspaceFolderSets: { version: 1, sets: [{ primary: APP, extraRoots: [API], displayName: 'Storefront' }] },
    conversationWorkspaceRoot: '/Users/test/Documents/Kun',
    workspaceRoot: APP,
    threads: [], adeThreads: [], activeThreadId: null, busy: false,
    selectWorkspaceRoot: fixture.selectCode,
    selectAdeWorkspaceRoot: fixture.selectAde
  } as unknown as ChatState
  fixture.save.mockResolvedValue({ ok: true, primary: APP })
  fixture.exists.mockResolvedValue(true)
  fixture.selectCode.mockResolvedValue(true)
  fixture.pick.mockResolvedValue({ canceled: false, path: API })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
    useCodeProjectEditorStore.getState().close()
  })
  host.remove()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function open(mode: 'create' | 'manage' = 'create', selectAfterSave: 'code' | 'ade' | null = null): Promise<void> {
  if (mode === 'manage') useCodeProjectEditorStore.getState().openManage(APP)
  else useCodeProjectEditorStore.getState().openCreate({ seedFolder: APP, selectAfterSave })
  await act(async () => root.render(createElement(CodeWorkspaceProjectDialog)))
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((node) => node.textContent?.trim() === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

async function click(text: string): Promise<void> {
  await act(async () => button(text).click())
}

function nameInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('#code-project-name')!
}

async function name(value: string): Promise<void> {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput(), value)
    nameInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function activeThread(status: 'idle' | 'running' = 'idle'): NormalizedThread {
  return { id: 'thread_1', workspace: APP, status } as NormalizedThread
}

describe('project dialog interactions', () => {
  it('creates a named project with the chosen primary and all extra folders', async () => {
    await open('create', 'code')
    expect(document.activeElement).toBe(nameInput())
    await name('Full stack')
    await click('Add folder')
    await click('Set as main')
    fixture.save.mockResolvedValueOnce({ ok: true, primary: API })
    await click('Create project')
    expect(fixture.save).toHaveBeenCalledExactlyOnceWith({ mode: 'create', displayName: 'Full stack', primary: API, extraRoots: [APP] }, { syncCurrentThread: false })
    expect(fixture.selectCode).toHaveBeenCalledExactlyOnceWith(API)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('cancels a modified draft without saving or changing the selected workspace', async () => {
    const registry = fixture.state.codeWorkspaceFolderSets
    await open()
    await name('Do not save')
    await click('Add folder')
    await click('Cancel')
    expect(fixture.save).not.toHaveBeenCalled()
    expect(fixture.selectCode).not.toHaveBeenCalled()
    expect(fixture.selectAde).not.toHaveBeenCalled()
    expect(fixture.setState).not.toHaveBeenCalled()
    expect(fixture.state.codeWorkspaceFolderSets).toBe(registry)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('keeps the primary fixed and leaves conversation sync opt-in when managing', async () => {
    fixture.state.activeThreadId = 'thread_1'
    fixture.state.threads = [activeThread()]
    await open('manage')
    expect(document.querySelector('[aria-label="Remove app"]')).toBeNull()
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.checked).toBe(false)
    expect(checkbox.disabled).toBe(false)
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Remove api"]')!.click())
    await click('Save changes')
    expect(fixture.save).toHaveBeenCalledWith({ mode: 'manage', displayName: 'Storefront', primary: APP, extraRoots: [] }, { syncCurrentThread: false })
  })

  it('allows explicit sync for the active idle ADE conversation', async () => {
    fixture.state.activeThreadId = 'thread_1'
    fixture.state.adeThreads = [activeThread()]
    await open('manage')
    const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox.disabled).toBe(false)
    await act(async () => checkbox.click())
    await click('Save changes')
    expect(fixture.save).toHaveBeenCalledWith(expect.objectContaining({ primary: APP }), { syncCurrentThread: true })
  })

  it('disables conversation sync while a turn is running', async () => {
    fixture.state.activeThreadId = 'thread_1'
    fixture.state.threads = [activeThread('running')]
    await open('manage')
    expect(document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true)
  })

  it('reports duplicate folders without changing the draft directory set', async () => {
    fixture.pick.mockResolvedValue({ canceled: false, path: APP })
    await open()
    await click('Add folder')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('duplicate')
    expect(document.querySelectorAll('[data-code-project-folder]')).toHaveLength(1)
    expect(fixture.save).not.toHaveBeenCalled()
  })

  it.each(['rejected', 'thrown', 'sync-blocked'] as const)('retains the draft on a %s save', async (failure) => {
    await open()
    await name('Keep this name')
    if (failure === 'rejected') fixture.save.mockResolvedValueOnce({ ok: false, error: 'Directory unavailable' })
    if (failure === 'thrown') fixture.save.mockRejectedValueOnce(new Error('Storage unavailable'))
    if (failure === 'sync-blocked') fixture.save.mockResolvedValueOnce({ ok: true, primary: APP, syncBlocked: 'Scope update failed' })
    await click('Create project')
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/unavailable|failed/)
    expect(nameInput().value).toBe('Keep this name')
    expect(button('Create project').disabled).toBe(false)
    expect(fixture.selectCode).not.toHaveBeenCalled()
  })

  it('keeps picker failures inline and allows retrying', async () => {
    fixture.pick.mockRejectedValueOnce(new Error('Picker unavailable'))
    await open()
    await click('Add folder')
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Picker unavailable')
    expect(button('Add folder').disabled).toBe(false)
    await click('Add folder')
    expect(document.querySelectorAll('[data-code-project-folder]')).toHaveLength(2)
  })

  it('traps Tab in the dialog and closes on Escape without saving', async () => {
    await open()
    await act(async () => button('Create project').focus())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(nameInput())
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })))
    expect(document.activeElement).toBe(button('Create project'))
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(fixture.save).not.toHaveBeenCalled()
  })
})
