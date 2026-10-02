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

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./RoomAgentBrowser', () => ({ RoomAgentBrowser: () => null }))
vi.mock('./RoomDirectChat', () => ({ RoomDirectFiles: () => null }))
vi.mock('../workbench/WorkbenchFileTreeSidePanel', () => ({ WorkbenchFileTreeSidePanel: () => null }))
const room = { id: 'agent-room', conversationKind: 'user_agent', privateWorkspace: '/private/a',
  members: [{ participantAgentId: 'agent-a' }] } as Room
let panel: RoomWorkbenchPanel
let renderer: ReactTestRenderer
function Harness() {
  panel = useRoomWorkbenchPanel(room.id)
  return createElement(RoomWorkbenchRightPanel, { room, messages: [], panel,
    collaboration: null, onCollaborationOpen: vi.fn(), contentPreview: createElement('div', { 'data-saved-preview': true }),
    contentPreviewTitle: 'report.md' })
}
const shell = () => renderer.root.findByType(WorkbenchRightSidebar)
const rail = () => renderer.root.findByType(WorkbenchSideRailSurface)
beforeEach(() => { vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1440 })) })
afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })

describe('private Agent Code sidebar', () => {
  it('uses the shared Code shell and rail without a generic collaboration tool', async () => {
    await act(async () => { renderer = create(createElement(Harness)) })
    act(() => panel.openTab(BUILTIN_RIGHT_PANEL_IDS.browser))
    expect(shell().props.width).toBe(560)
    expect(shell().props.dividerProps['data-room-workbench-resize']).toBe(true)
    expect(rail().findAllByType('button').map((button) => button.props['aria-label']))
      .toEqual(['rightPanelChanges', 'rightPanelBrowserTool', 'rightPanelFiles'])
    expect(rail().findByProps({ 'data-room-tool': 'browser' }).props.className).toBe(sideRailButtonClass(true))
    expect(renderer.root.findByType(RoomAgentBrowser).props.active).toBe(true)
    act(() => panel.collapse())
    expect(shell().props.visible).toBe(false)
    expect(renderer.root.findByType(RoomAgentBrowser).props.active).toBe(false)
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
})
