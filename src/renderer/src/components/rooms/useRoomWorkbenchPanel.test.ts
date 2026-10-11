import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoomContentReference } from '@shared/rooms-api'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import { ROOM_COLLABORATION_TAB, useRoomWorkbenchPanel } from './useRoomWorkbenchPanel'

describe('room workbench presentation scope', () => {
  let renderer: ReactTestRenderer
  let panel: ReturnType<typeof useRoomWorkbenchPanel>
  function Harness({ roomId }: { roomId: string }) {
    panel = useRoomWorkbenchPanel(roomId)
    return null
  }
  beforeEach(() => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { kunGui: { platform: 'darwin' } }))
    vi.stubGlobal('CustomEvent', class extends Event {
      detail: unknown
      constructor(name: string, options: { detail: unknown }) { super(name); this.detail = options.detail }
    })
  })
  afterEach(() => { if (renderer) act(() => renderer.unmount()); vi.unstubAllGlobals() })
  it('opens file previews in the room panel and returns to preserved collaboration', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'agent-a' })) })
    act(() => panel.openCollaboration())
    act(() => previewWorkspaceFile({ path: '/private/a/result.md', workspaceRoot: '/private/a' }))
    expect(panel.state.tabs).toEqual([ROOM_COLLABORATION_TAB, BUILTIN_RIGHT_PANEL_IDS.file])
    expect(panel.state.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.file)
    expect(panel.fileTarget?.workspaceRoot).toBe('/private/a')
    act(() => panel.closeFile(panel.fileTarget!))
    expect(panel.state.activeId).toBe(ROOM_COLLABORATION_TAB)
    expect(panel.fileTargets).toEqual([])
  })
  it('clears old room files and ignores callbacks retained by the previous room', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'agent-a' })) })
    const previous = panel
    act(() => panel.previewFile({ path: '/private/a/secret.md', workspaceRoot: '/private/a' }))
    act(() => renderer.update(createElement(Harness, { roomId: 'group-b' })))
    expect(panel.fileTarget).toBeNull()
    expect(panel.state.tabs).toEqual([])
    act(() => previous.previewFile({ path: '/private/a/late.md', workspaceRoot: '/private/a' }))
    expect(panel.fileTargets).toEqual([])
    act(() => previewWorkspaceFile({ path: '/project/b/result.md', workspaceRoot: '/project/b' }))
    expect(panel.fileTargets.map((target) => target.path)).toEqual(['/project/b/result.md'])
    act(() => renderer.update(createElement(Harness, { roomId: 'agent-a' })))
    expect(panel.fileTarget).toBeNull()
  })
  it('shares the file workspace between saved content and local file previews', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'agent-a' })) })
    const reference = { kind: 'agent_file', artifactId: 'saved', artifactVersion: 2,
      workspaceId: 'private-a', relativePath: 'report.md', titleSnapshot: 'Report' } as RoomContentReference
    act(() => panel.previewContent(reference, 'message-1'))
    expect(panel.state.tabs).toEqual([BUILTIN_RIGHT_PANEL_IDS.file])
    expect(panel.contentTarget).toMatchObject({ reference, messageId: 'message-1' })
    const firstKey = panel.contentTarget?.key
    act(() => panel.previewFile({ path: '/private/a/local.md', workspaceRoot: '/private/a' }))
    expect(panel.contentTarget).toBeNull()
    act(() => panel.previewContent(reference))
    expect(panel.fileTarget).toBeNull()
    expect(panel.contentTarget?.key).not.toBe(firstKey)
    act(() => panel.closeTab(BUILTIN_RIGHT_PANEL_IDS.file))
    expect(panel.contentTarget).toBeNull()
    expect(panel.fileTargets).toEqual([])
  })
  it('rejects saved-content callbacks from a previous room', async () => {
    await act(async () => { renderer = create(createElement(Harness, { roomId: 'agent-a' })) })
    const previous = panel
    const reference = { kind: 'agent_file', artifactId: 'saved', artifactVersion: 1,
      workspaceId: 'private-a', relativePath: 'report.md' } as RoomContentReference
    act(() => panel.previewContent(reference))
    act(() => renderer.update(createElement(Harness, { roomId: 'agent-b' })))
    expect(panel.contentTarget).toBeNull()
    act(() => previous.previewContent(reference))
    expect(panel.contentTarget).toBeNull()
    expect(panel.state.tabs).toEqual([])
  })

})
