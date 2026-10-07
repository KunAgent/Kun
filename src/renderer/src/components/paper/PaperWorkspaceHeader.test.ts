/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PaperWorkspaceHeader } from './PaperWorkspaceHeader'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { usePaperWorkspaceBootstrapStore } from '../../paper/paper-workspace-bootstrap'

const actions = vi.hoisted(() => ({ switch: vi.fn(), add: vi.fn() }))
vi.mock('../../paper/paper-mode-actions', () => ({
  switchPaperLibrary: actions.switch,
  addPaperLibrary: actions.add
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key })
}))

const DEFAULT = '/home/reader/paper-workspaces/default'
const OTHER = '/home/reader/Research'
let root: Root
let host: HTMLDivElement
let pick: ReturnType<typeof vi.fn>

async function render(): Promise<void> {
  await act(async () => root.render(createElement(PaperWorkspaceHeader)))
}

function select(): HTMLSelectElement {
  return host.querySelector('select')!
}

async function choose(value: string): Promise<void> {
  await act(async () => {
    select().value = value
    select().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function add(): HTMLButtonElement {
  return host.querySelector('[data-testid="paper-workspace-add"]')!
}

describe('PaperWorkspaceHeader', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    actions.switch.mockResolvedValue({ ok: true })
    actions.add.mockResolvedValue({ ok: true })
    pick = vi.fn().mockResolvedValue({ canceled: true })
    Object.defineProperty(window, 'kunGui', { configurable: true, value: { pickWorkspaceDirectory: pick } })
    const paperMode = useWriteWorkspaceStore.getState().paperMode
    useWriteWorkspaceStore.setState({ workspaceRoot: DEFAULT, paperMode: { ...paperMode, activeLibrary: DEFAULT, libraries: [DEFAULT, OTHER] } })
    usePaperWorkspaceBootstrapStore.setState({ defaultWorkspaceRoot: DEFAULT })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('names the current workspace and exposes its location and native switcher', async () => {
    await render()
    expect(select().value).toBe(DEFAULT)
    expect(select().getAttribute('aria-label')).toBe('paperWorkspaceSwitch')
    expect(select().selectedOptions[0].textContent).toContain('paperWorkspaceDefaultName')
    expect(host.textContent).toContain(DEFAULT)
    expect(host.querySelectorAll('option')).toHaveLength(2)
  })

  it('preserves the current selection and stays silent when switching is canceled', async () => {
    actions.switch.mockResolvedValue({ ok: false, message: 'switch-canceled' })
    await render()
    await choose(OTHER)
    expect(actions.switch).toHaveBeenCalledWith(OTHER)
    expect(select().value).toBe(DEFAULT)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows a save failure and retains the previous workspace', async () => {
    actions.switch.mockResolvedValue({ ok: false, message: 'save-failed' })
    await render()
    await choose(OTHER)
    expect(select().value).toBe(DEFAULT)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('writePaperModeSaveFailed')
    expect(select().disabled).toBe(false)
  })

  it('handles thrown switch errors without leaving controls busy', async () => {
    actions.switch.mockRejectedValue(new Error('Permission denied'))
    await render()
    await choose(OTHER)
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Permission denied')
    expect(add().disabled).toBe(false)
  })

  it('keeps cancellation of the folder picker silent and does not add a library', async () => {
    await render()
    await act(async () => add().click())
    expect(pick).toHaveBeenCalledWith(DEFAULT)
    expect(actions.add).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  it('guards double clicks for the full picker lifetime and activates the chosen folder', async () => {
    let resolve!: (value: { canceled: boolean; path: string }) => void
    pick.mockReturnValue(new Promise((done) => { resolve = done }))
    await render()
    await act(async () => { add().click(); add().click() })
    expect(pick).toHaveBeenCalledTimes(1)
    expect(add().disabled).toBe(true)
    expect(select().disabled).toBe(true)
    await act(async () => resolve({ canceled: false, path: OTHER }))
    expect(actions.add).toHaveBeenCalledTimes(1)
    expect(actions.add).toHaveBeenCalledWith(OTHER)
    expect(add().disabled).toBe(false)
  })

  it('reports picker failure and permits a fresh attempt', async () => {
    pick.mockRejectedValueOnce(new Error('Access denied'))
    await render()
    await act(async () => add().click())
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Access denied')
    await act(async () => add().click())
    expect(pick).toHaveBeenCalledTimes(2)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})
