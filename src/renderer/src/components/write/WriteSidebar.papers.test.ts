/** @vitest-environment jsdom */
import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WriteSidebar } from './WriteSidebar'

const mocked = vi.hoisted(() => ({ route: 'papers', mobile: false, load: vi.fn(async () => undefined) }))
vi.mock('../../store/chat-store', () => ({ useChatStore: (select: (state: Record<string, unknown>) => unknown) => select({
  route: mocked.route, clawChannels: [], addClawChannel: vi.fn(), deleteClawChannel: vi.fn(), runtimeConnection: 'ready'
}) }))
vi.mock('../../write/write-workspace-store', () => ({ useWriteWorkspaceStore: (select: (state: Record<string, unknown>) => unknown) => select({
  workspaceRoot: '/work', loadWriteSettings: mocked.load
}) }))
vi.mock('../../lib/remote-mobile', () => ({ useRemoteMobileLayout: () => mocked.mobile }))
vi.mock('../../write/work-session-actions', () => ({ startWorkSession: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../sidebar/SidebarPrimitives', () => ({ SidebarFrame: ({ children }: { children: ReactNode }) => createElement('nav', null, children) }))
vi.mock('../sidebar/SidebarStandardFooter', () => ({ SidebarStandardFooter: () => null }))
vi.mock('../chat/ConnectPhoneView', () => ({ ConnectPhoneSidebarPanel: () => null }))
vi.mock('../chat/WorkspaceModeTabs', () => ({ WorkspaceModeTabs: () => null }))
vi.mock('./WorkWhiteboardTitleDialog', () => ({ WorkWhiteboardTitleDialog: () => null }))
vi.mock('./WriteEntryDialog', () => ({ WriteEntryDialog: () => null }))
vi.mock('./WorkSidebarNav', () => ({ WorkSidebarPrimaryActions: () => null }))
vi.mock('./WorkSpaceSwitcher', () => ({ WorkSpaceSwitcher: () => null }))
vi.mock('./WorkSessionsSection', () => ({ WorkSessionsSection: () => null }))
vi.mock('./WorkFilesSection', () => ({ WorkFilesSection: () => null }))
vi.mock('./WorkArtifactsSection', () => ({ WorkArtifactsSection: () => null }))
vi.mock('./WorkPapersSection', () => ({ WorkPapersSection: () => createElement('span', { 'data-testid': 'papers-row' }) }))
vi.mock('./use-work-directory-actions', () => ({ useWorkDirectoryActions: () => ({
  whiteboardCreation: { newWhiteboardDialogOpen: false }, entryDialog: null, setEntryDialog: vi.fn(),
  openCreateFileDialog: vi.fn(), pickWriteWorkspace: vi.fn()
}) }))

const props = {
  activeView: 'write' as const, connectPhoneSidebarOpen: false, focusModeEnabled: false,
  onCodeOpen: vi.fn(), onWriteOpen: vi.fn(), onFocusModeChange: vi.fn(), onOpenSettings: vi.fn(), onToggleConnectPhone: vi.fn()
}
let tree: ReactTestRenderer | undefined
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocked.route = 'papers'
  mocked.mobile = false
  mocked.load.mockClear()
})
afterEach(async () => {
  await act(async () => { tree?.unmount() })
  tree = undefined
  vi.unstubAllGlobals()
})

describe('paper route sidebar boundary', () => {
  it('shows the global entry without initializing or loading a Work folder', async () => {
    await act(async () => { tree = create(createElement(WriteSidebar, props)) })
    expect(tree!.root.findAllByProps({ 'data-testid': 'papers-row' })).toHaveLength(1)
    expect(mocked.load).not.toHaveBeenCalled()
  })

  it('loads Work only when the user actually returns to the Work route', async () => {
    await act(async () => { tree = create(createElement(WriteSidebar, props)) })
    mocked.route = 'write'
    await act(async () => { tree!.update(createElement(WriteSidebar, { ...props })) })
    expect(mocked.load).toHaveBeenCalledTimes(1)
    mocked.route = 'papers'
    await act(async () => { tree!.update(createElement(WriteSidebar, { ...props })) })
    expect(mocked.load).toHaveBeenCalledTimes(1)
  })

  it('keeps the phone paper-home boundary unchanged', async () => {
    mocked.mobile = true
    mocked.route = 'write'
    await act(async () => { tree = create(createElement(WriteSidebar, props)) })
    expect(tree!.root.findAllByProps({ 'data-testid': 'papers-row' })).toHaveLength(0)
    expect(mocked.load).toHaveBeenCalledTimes(1)
  })
})
