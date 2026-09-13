import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexReferenceDialog } from './CodexReferenceDialog'
import type { HistoryPreview } from './history-reference-api'

const state = vi.hoisted(() => ({ request: vi.fn(), create: vi.fn(), pickFiles: vi.fn(), pickDirectory: vi.fn(), refresh: vi.fn() }))
vi.mock('react-dom', () => ({ createPortal: (children: unknown) => children }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../store/chat-store', () => ({ useChatStore: { getState: () => ({ refreshThreads: state.refresh }) } }))
vi.mock('./use-codex-reference-enabled', () => ({ useCodexReferenceEnabled: () => true }))
vi.mock('./SourceHistoryPreview', () => ({ SourceHistoryPreview: (props: { onMore: () => void }) => createElement('button', { onClick: props.onMore }, 'more') }))
vi.mock('./history-reference-api', () => ({ historyRequest: state.request, createReferenceBranch: state.create }))
let renderer: ReactTestRenderer | undefined
function preview(path = '/source.jsonl', cwd = '/project-b'): HistoryPreview {
  return { session: { path, sessionId: 'session', title: 'Session', workspace: cwd, archived: false, updatedAt: '2026-09-13T00:00:00Z' },
    cutoffs: [{ turnId: 'codex:a', label: 'A', createdAt: '', workspace: cwd ? '/project-a' : '' },
      { turnId: 'codex:b', label: 'B', createdAt: '', workspace: cwd }], warnings: [],
    page: { turns: [], hasMore: true, nextCursor: 'older', status: 'available', warnings: [] } }
}
const button = (label: string) => renderer!.root.findAllByType('button').find((node) => node.children.includes(label))!
const workspaceInput = () => renderer!.root.findAllByType('label').find((node) => node.children.includes('codexHistoryWorkspace'))!.findByType('input')
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('document', { activeElement: null, body: {} })
  vi.stubGlobal('window', { setTimeout: () => 1, kunGui: { pickLocalFiles: state.pickFiles, pickWorkspaceDirectory: state.pickDirectory } })
  state.request.mockReset(); state.create.mockReset(); state.pickFiles.mockReset(); state.pickDirectory.mockReset()
  state.refresh.mockResolvedValue(undefined)
  state.create.mockResolvedValue({ thread: { id: 'branch' } })
  state.pickFiles.mockResolvedValue({ canceled: false, paths: ['/source.jsonl'] })
  state.request.mockResolvedValue(preview())
})
afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals() })
async function mount(): Promise<void> {
  await act(async () => { renderer = create(createElement(CodexReferenceDialog, {
    workspaceRoot: '/global-project', onClose: vi.fn(), onCreated: vi.fn()
  })) })
  await act(async () => { button('codexHistoryChooseFiles').props.onClick() })
}
async function chooseCutoff(): Promise<void> {
  await act(async () => { renderer!.root.findAllByType('select').at(-1)!.props.onChange({ target: { value: 'codex:a' } }) })
}
async function submit(): Promise<void> {
  await act(async () => { button('codexHistoryCreate').props.onClick() })
}

describe('Codex branch workspace defaults', () => {
  it('disables creation when the selected preview has no completed cutoff', async () => {
    state.request.mockResolvedValue({ ...preview(), cutoffs: [] })
    await mount()
    expect(button('codexHistoryCreate').props.disabled).toBe(true)
  })

  it('shows the last completed cutoff workspace even if the preview has a newer unfinished tail', async () => {
    const value = preview()
    value.session.workspace = '/unfinished-workspace'
    state.request.mockResolvedValue(value)
    await mount()
    expect(workspaceInput().props.value).toBe('/project-b')
    await submit()
    expect(state.create.mock.calls[0]![0]).not.toHaveProperty('workspace')
  })

  it('clears the old selection when changing sources and creates a Claude branch explicitly', async () => {
    await mount()
    await act(async () => { renderer!.root.findAllByType('select')[0]!.props.onChange({ target: { value: 'claude-code' } }) })
    expect(button('codexHistoryCreate').props.disabled).toBe(true)
    await act(async () => { button('codexHistoryChooseFiles').props.onClick() })
    expect(state.request).toHaveBeenLastCalledWith('/v1/history-sources/claude-code/preview', expect.objectContaining({ path: '/source.jsonl' }))
    await submit()
    expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({ sourceProvider: 'claude-code' }))
  })

  it('shows the selected cutoff directory and leaves its authoritative default to the runtime', async () => {
    await mount()
    expect(workspaceInput().props.value).toBe('/project-b')
    await chooseCutoff()
    expect(workspaceInput().props.value).toBe('/project-a')
    await submit()
    expect(state.create.mock.calls[0]![0]).toMatchObject({ path: '/source.jsonl', cutoffTurnId: 'codex:a' })
    expect(state.create.mock.calls[0]![0]).not.toHaveProperty('workspace')
  })
  it('preserves an explicit workspace edit across cutoff selection and preview pagination', async () => {
    await mount()
    await act(async () => { workspaceInput().props.onChange({ target: { value: '/custom-project' } }) })
    await chooseCutoff()
    await act(async () => { button('more').props.onClick() })
    expect(workspaceInput().props.value).toBe('/custom-project')
    await submit()
    expect(state.create.mock.calls[0]![0]).toMatchObject({ workspace: '/custom-project', cutoffTurnId: 'codex:a' })
  })
  it('clears a manual directory override when previewing another source', async () => {
    await mount()
    state.pickDirectory.mockResolvedValue({ canceled: false, path: '/picked-project' })
    await act(async () => { button('codexHistoryChoose').props.onClick() })
    expect(workspaceInput().props.value).toBe('/picked-project')
    state.pickFiles.mockResolvedValue({ canceled: false, paths: ['/other.jsonl'] })
    state.request.mockResolvedValue(preview('/other.jsonl', '/other-project'))
    await act(async () => { button('codexHistoryChooseFiles').props.onClick() })
    expect(workspaceInput().props.value).toBe('/other-project')
    await submit()
    expect(state.create.mock.calls[0]![0]).not.toHaveProperty('workspace')
  })
  it('sends the displayed global-directory fallback only when the source has no effective cwd', async () => {
    state.request.mockResolvedValue(preview('/source.jsonl', ''))
    await mount()
    expect(workspaceInput().props.value).toBe('/global-project')
    await chooseCutoff()
    await submit()
    expect(state.create.mock.calls[0]![0]).toMatchObject({ workspace: '/global-project', cutoffTurnId: 'codex:a' })
  })
})
