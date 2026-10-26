import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkViewStore } from './work-view-store'
import { useWorkSlotsStore } from './work-slots-store'
import { useWriteWorkspaceStore } from './write-workspace-store'

describe('work view store', () => {
  beforeEach(() => {
    useWorkViewStore.setState({ sessionTabs: {}, split: false, peek: false })
    useWorkSlotsStore.setState({ assistantMain: false })
  })

  it('keeps one tab per session and closes it again', () => {
    const view = useWorkViewStore.getState()
    view.openSessionTab('/space', 'thread-a')
    view.openSessionTab('/space', 'thread-b')
    view.openSessionTab('/space', 'thread-a')
    const key = Object.keys(useWorkViewStore.getState().sessionTabs)[0]!
    expect(useWorkViewStore.getState().sessionTabs[key]).toEqual(['thread-a', 'thread-b'])
    view.closeSessionTab('/space', 'thread-a')
    expect(useWorkViewStore.getState().sessionTabs[key]).toEqual(['thread-b'])
  })

  it('gives the stage to the session or the file and folds the assistant panel without the split', () => {
    useWorkViewStore.getState().showSession()
    expect(useWorkSlotsStore.getState().assistantMain).toBe(true)
    useWorkViewStore.getState().showDocument()
    expect(useWorkSlotsStore.getState().assistantMain).toBe(false)
    expect(useWriteWorkspaceStore.getState().writeRightPanel.expanded).toBe(false)
    useWorkViewStore.getState().toggleSplit()
    expect(useWorkViewStore.getState().split).toBe(true)
    expect(useWriteWorkspaceStore.getState().writeRightPanel.expanded).toBe(true)
  })

  it('treats the peek and the split as exclusive', () => {
    useWorkViewStore.getState().toggleSplit()
    useWorkViewStore.getState().setPeek(true)
    expect(useWorkViewStore.getState()).toMatchObject({ peek: true, split: false })
    useWorkViewStore.getState().toggleSplit()
    expect(useWorkViewStore.getState()).toMatchObject({ peek: false, split: true })
  })
})
