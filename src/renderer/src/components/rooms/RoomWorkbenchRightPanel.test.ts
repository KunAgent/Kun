import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Room, RoomContentReference } from '@shared/rooms-api'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { WorkbenchRightSidebar } from '../workbench/WorkbenchRightSidebar'
import { WorkbenchSideRailSurface, sideRailButtonClass } from '../workbench/WorkbenchSideRail'
import { WorkbenchFileTreeSidePanel } from '../workbench/WorkbenchFileTreeSidePanel'
import { RoomAgentBrowser } from './RoomAgentBrowser'
import { RoomDirectFiles } from './RoomDirectChat'
import { RoomWorkbenchRightPanel } from './RoomWorkbenchRightPanel'
import { useRoomWorkbenchPanel, type RoomWorkbenchPanel } from './useRoomWorkbenchPanel'
import { useRailCollapseStore } from '../workbench/rail-collapse'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: vi.fn() }
}))
vi.mock('./RoomAgentBrowser', () => ({ RoomAgentBrowser: () => null }))
vi.mock('./RoomDirectChat', () => ({ RoomDirectFiles: () => null }))
vi.mock('../workbench/WorkbenchFileTreeSidePanel', () => ({ WorkbenchFileTreeSidePanel: () => null }))
const room = { id: 'agent-room', conversationKind: 'user_agent', privateWorkspace: '/private/a',
  members: [{ participantAgentId: 'agent-a' }] } as Room
let panel: RoomWorkbenchPanel
let renderer: ReactTestRenderer
const onCollaborationOpen = vi.fn()
function Harness() {
  panel = useRoomWorkbenchPanel(room.id)
  return createElement(RoomWorkbenchRightPanel, { room, messages: [], panel,
    collaboration: null, onCollaborationOpen, contentPreview: createElement('div', { 'data-saved-preview': true }),
    contentPreviewTitle: 'report.md' })
}
const shell = () => renderer.root.findByType(WorkbenchRightSidebar)
const rail = () => renderer.root.findByType(WorkbenchSideRailSurface)
beforeEach(() => { vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1440 })) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

describe('private Agent Code sidebar', () => {
  it('uses the shared Code shell and rail with an Agent session tool', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    act(() => panel.openTab(BUILTIN_RIGHT_PANEL_IDS.browser))
    expect(shell().props.width).toBe(560)
    expect(shell().props.dividerProps['data-room-workbench-resize']).toBe(true)
    expect(rail().findAllByType('button').map((button) => button.props['aria-label']))
      .toEqual(['railCollapse', 'rightPanelFiles', 'rightPanelChanges', 'rightPanelBrowserTool', 'roomsAgentSession', 'rightPanelWardrobe'])
    expect(rail().findByProps({ 'data-room-tool': 'browser' }).props.className).toBe(sideRailButtonClass(true))
    expect(renderer.root.findByType(RoomAgentBrowser).props.active).toBe(true)
    act(() => panel.collapse())
    expect(shell().props.visible).toBe(false)
    expect(renderer.root.findByType(RoomAgentBrowser).props.active).toBe(false)
  })
  it('opens the whole Agent session from the rail', async () => {
    onCollaborationOpen.mockClear()
    await act(async () => { renderer = create(createElement(Harness)) })
    act(() => rail().findByProps({ 'data-room-tool': 'session' }).props.onClick())
    expect(onCollaborationOpen).toHaveBeenCalledTimes(1)
    expect(panel.state.expanded).toBe(true)
  })
  it('renders saved previews as titled file tabs and highlights the selected library item', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    const reference = { kind: 'agent_file', artifactId: 'saved', artifactVersion: 2,
      workspaceId: 'private-a', relativePath: 'report.md' } as RoomContentReference
    act(() => panel.openTab(BUILTIN_RIGHT_PANEL_IDS.files))
    act(() => panel.previewContent(reference))
    expect(renderer.root.findAllByProps({ 'data-saved-preview': true })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ role: 'tab' }).map((tab) => tab.props['aria-label']))
      .toEqual(['rightPanelFiles', 'report.md'])
    expect(renderer.root.findByType(RoomDirectFiles).props.selectedReference).toEqual(reference)
  })
  it('keeps one private file-source toolbar instead of nesting the Code Design switcher', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    act(() => panel.openTab(BUILTIN_RIGHT_PANEL_IDS.files))
    const workspace = renderer.root.findAllByType('button').find((button) => button.children.includes('roomsArtifactWorkspaceFiles'))!
    act(() => workspace.props.onClick())
    expect(renderer.root.findByType(WorkbenchFileTreeSidePanel).props.showViewTabs).toBe(false)
    expect(renderer.root.findByType(WorkbenchFileTreeSidePanel).props.view).toBe('workspace')
  })
  it('folds away with the shared Code and Work rail collapse', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    act(() => rail().findByProps({ 'aria-label': 'railCollapse' }).props.onClick())
    expect(renderer.root.findAllByType(WorkbenchSideRailSurface)).toHaveLength(0)
    act(() => useRailCollapseStore.getState().setCollapsed(false))
    expect(renderer.root.findAllByType(WorkbenchSideRailSurface)).toHaveLength(1)
  })
  it('opens the wardrobe from the rail without an unread badge', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    const wardrobe = rail().findByProps({ 'data-room-tool': 'wardrobe' })
    expect(wardrobe.findAll((node) => node.props['data-rail-badge'] !== undefined)).toHaveLength(0)
    act(() => wardrobe.props.onClick())
    expect(panel.state.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.wardrobe)
    expect(panel.state.expanded).toBe(true)
  })
})
