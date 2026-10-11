// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, string>())
vi.mock('../../lib/browser-storage', () => ({
  readBrowserStorageItem: (key: string) => storage.get(key) ?? null,
  writeBrowserStorageItem: (key: string, value: string) => { storage.set(key, value) }
}))
import { useRoomPresentationPreferences } from './room-presentation-preferences'
import { useConversationInfoBoard } from './useConversationInfoBoard'
import { CONVERSATION_INFO_TAB, type RoomWorkbenchPanel } from './useRoomWorkbenchPanel'

type PanelState = RoomWorkbenchPanel['state']
const openTab = vi.fn()
const collapse = vi.fn()
const panel = (state: Partial<PanelState>): RoomWorkbenchPanel => ({
  state: { tabs: [], activeId: null, expanded: false, ...state } as PanelState, openTab, collapse
} as unknown as RoomWorkbenchPanel)
const showing = panel({ tabs: [CONVERSATION_INFO_TAB], activeId: CONVERSATION_INFO_TAB, expanded: true })

let root: Root
let host: HTMLDivElement
let board: ReturnType<typeof useConversationInfoBoard>
function Probe({ value, scope, ready }: { value: RoomWorkbenchPanel; scope: string | null; ready: boolean }) {
  board = useConversationInfoBoard(value, scope, ready)
  return null
}
async function render(value: RoomWorkbenchPanel, scope: string | null, ready = true): Promise<void> {
  await act(async () => root.render(createElement(Probe, { value, scope, ready })))
}
const remembered = () => useRoomPresentationPreferences.getState().infoBoard

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  openTab.mockReset(); collapse.mockReset()
  useRoomPresentationPreferences.getState().setPreference({ infoBoard: false })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('conversation info board preference', () => {
  it('stays closed by default and remembers the board once the user opens it', async () => {
    await render(panel({}), 'dm-a')
    expect(openTab).not.toHaveBeenCalled()
    act(() => board.toggle())
    expect(openTab).toHaveBeenCalledWith(CONVERSATION_INFO_TAB)
    await render(showing, 'dm-a')
    expect(remembered()).toBe(true)
    expect(board.active).toBe(true)
  })

  it('reopens the remembered board for the next conversation once it is ready', async () => {
    useRoomPresentationPreferences.getState().setPreference({ infoBoard: true })
    await render(panel({}), 'group-b', false)
    expect(openTab).not.toHaveBeenCalled()
    await render(panel({}), 'group-b', true)
    expect(openTab).toHaveBeenCalledExactlyOnceWith(CONVERSATION_INFO_TAB)
    await render(panel({ tabs: ['builtin:right-panel-files'], activeId: 'builtin:right-panel-files', expanded: true } as never), 'dm-c')
    expect(openTab).toHaveBeenCalledOnce()
  })

  it('forgets the board when it is collapsed or closed, but not when switching conversations', async () => {
    useRoomPresentationPreferences.getState().setPreference({ infoBoard: true })
    await render(showing, 'dm-a')
    await render(panel({}), 'dm-b')
    expect(remembered()).toBe(true)
    await render(showing, 'dm-b')
    act(() => board.toggle())
    expect(collapse).toHaveBeenCalledOnce()
    await render(panel({ tabs: [CONVERSATION_INFO_TAB], activeId: CONVERSATION_INFO_TAB, expanded: false }), 'dm-b')
    expect(remembered()).toBe(false)
    await render(showing, 'dm-b')
    expect(remembered()).toBe(true)
    await render(panel({ tabs: ['builtin:right-panel-files'], activeId: 'builtin:right-panel-files', expanded: true } as never), 'dm-b')
    expect(remembered()).toBe(false)
  })
})
