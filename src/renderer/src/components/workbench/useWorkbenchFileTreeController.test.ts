import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { WorkspaceFileTarget } from '@shared/workspace-file'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import type { RightPanelMode } from '../chat/WorkbenchTopBar'
import {
  closeFilePreviewTarget,
  closeOtherFilePreviewTargets,
  migrateLegacyPinnedFilePreviewTargetKeys,
  parsePinnedFilePreviewTargetKeys,
  retainFilePreviewTargets,
  useWorkbenchFileTreeController,
  workspaceFileTargetKey
} from './useWorkbenchFileTreeController'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const targets: WorkspaceFileTarget[] = [
  { path: '/repo/docs/One.md', workspaceRoot: '/repo' },
  { path: '/repo/docs/two.md', workspaceRoot: '/repo' },
  { path: '/repo/docs/three.md', workspaceRoot: '/repo' }
]

describe('file preview tab lifecycle helpers', () => {
  it('preserves POSIX case while folding Windows drive and UNC targets', () => {
    expect(workspaceFileTargetKey(targets[0], 'linux')).not.toBe(
      workspaceFileTargetKey({ ...targets[0], path: '/repo/docs/one.md' }, 'linux')
    )
    expect(workspaceFileTargetKey(
      { path: 'C:\\Repo\\Docs\\One.md', workspaceRoot: 'C:\\Repo' },
      'linux'
    )).toBe('c:/repo\nc:/repo/docs/one.md')
    expect(workspaceFileTargetKey(
      { path: '\\\\Server\\Share\\One.md', workspaceRoot: '\\\\Server\\Share' },
      'linux'
    )).toBe('//server/share\n//server/share/one.md')
    expect(workspaceFileTargetKey(
      { path: ' /repo//docs/One.md ', workspaceRoot: '/repo///' },
      'linux'
    )).toBe('/repo\n/repo/docs/One.md')
  })

  it('keeps only pinned tabs when preservation is disabled', () => {
    const pinned = new Set([workspaceFileTargetKey(targets[1], 'linux')])
    expect(retainFilePreviewTargets(targets, pinned, false)).toEqual([targets[1]])
    expect(retainFilePreviewTargets(targets, pinned, true)).toEqual(targets)
  })

  it('keeps other pinned tabs for close-others but lets an explicit close unpin them', () => {
    const pinnedKey = workspaceFileTargetKey(targets[1], 'linux')
    expect(closeOtherFilePreviewTargets(targets, targets[0], new Set([pinnedKey]))).toEqual([
      targets[0],
      targets[1]
    ])

    expect(closeFilePreviewTarget(targets, [pinnedKey], targets[1], targets[1])).toEqual({
      targets: [targets[0], targets[2]],
      pinnedTargetKeys: [],
      activeTarget: targets[0]
    })
  })

  it('bounds and validates persisted keys and migrates only reversible Windows legacy keys', () => {
    const values = Array.from({ length: 205 }, (_, index) => `/repo\n/repo/${index}.md`)
    expect(parsePinnedFilePreviewTargetKeys(JSON.stringify(values), 'linux')).toHaveLength(200)
    expect(parsePinnedFilePreviewTargetKeys('{broken', 'linux')).toEqual([])
    expect(parsePinnedFilePreviewTargetKeys(JSON.stringify(['title-only', 4]), 'linux')).toEqual([])

    const legacy = JSON.stringify([
      'c:/repo\nc:/repo\nc:/repo/docs/one.md',
      'c:/repo\nd:/other\nd:/other/two.md',
      'malformed'
    ])
    expect(migrateLegacyPinnedFilePreviewTargetKeys(legacy, 'win32')).toEqual([
      'c:/repo\nc:/repo/docs/one.md',
      'd:/other\nd:/other/two.md'
    ])
    expect(migrateLegacyPinnedFilePreviewTargetKeys(legacy, 'linux')).toEqual([])
  })
})

type HarnessProps = {
  activeThreadId: string | null
  rightPanelMode: RightPanelMode
  onSetRightPanelMode: (mode: RightPanelMode) => void
}

let latestController: ReturnType<typeof useWorkbenchFileTreeController>

function ControllerHarness({ activeThreadId, rightPanelMode, onSetRightPanelMode }: HarnessProps) {
  const [filePreviewTarget, setFilePreviewTarget] = useState<WorkspaceFileTarget | null>(null)
  latestController = useWorkbenchFileTreeController({
    route: 'chat',
    threads: [],
    activeThreadId,
    workspaceRoot: '/repo',
    activeSkillWorkspace: '/repo',
    rightPanelMode,
    filePreviewTarget,
    setFilePreviewTarget,
    setRightPanelMode: onSetRightPanelMode
  })
  return null
}

describe('useWorkbenchFileTreeController thread transitions', () => {
  let renderer: ReactTestRenderer
  let setRightPanelMode: Mock<(mode: RightPanelMode) => void>
  let storage: MemoryStorage

  beforeEach(async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    storage = new MemoryStorage()
    vi.stubGlobal('window', {
      kunGui: { platform: 'linux' },
      localStorage: storage
    })
    setRightPanelMode = vi.fn<(mode: RightPanelMode) => void>()
    await act(async () => {
      renderer = create(createElement(ControllerHarness, {
        activeThreadId: 'thread-a',
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
  })

  afterEach(async () => {
    await act(async () => renderer.unmount())
    vi.unstubAllGlobals()
  })

  it('prunes hidden unpinned tabs across A -> null -> B without closing another panel', async () => {
    await act(async () => {
      latestController.openWorkspaceFilePreviewTarget(targets[0])
      latestController.openWorkspaceFilePreviewTarget(targets[1])
      latestController.togglePinnedFilePreviewTarget(targets[1])
    })
    setRightPanelMode.mockClear()

    await act(async () => {
      renderer.update(createElement(ControllerHarness, {
        activeThreadId: null,
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.openFilePreviewTargets).toEqual([targets[1]])

    await act(async () => {
      renderer.update(createElement(ControllerHarness, {
        activeThreadId: 'thread-b',
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.openFilePreviewTargets).toEqual([targets[1]])
    expect(setRightPanelMode).not.toHaveBeenCalledWith(null)
  })

  it('applies a disabled preservation setting on the next thread switch', async () => {
    await act(async () => {
      latestController.openWorkspaceFilePreviewTarget(targets[0])
      latestController.togglePinnedFilePreviewTarget(targets[0])
      latestController.openWorkspaceFilePreviewTarget(targets[1])
      latestController.togglePreserveFilePreviewTargets()
    })
    expect(latestController.preserveFilePreviewTargets).toBe(true)

    await act(async () => latestController.togglePreserveFilePreviewTargets())
    expect(latestController.preserveFilePreviewTargets).toBe(false)
    expect(latestController.openFilePreviewTargets).toEqual([targets[0], targets[1]])

    await act(async () => {
      renderer.update(createElement(ControllerHarness, {
        activeThreadId: 'thread-b',
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.openFilePreviewTargets).toEqual([targets[0]])
    expect(setRightPanelMode).not.toHaveBeenCalledWith(null)
  })

  it('retains every tab across thread switches while preservation is enabled', async () => {
    await act(async () => {
      latestController.openWorkspaceFilePreviewTarget(targets[0])
      latestController.openWorkspaceFilePreviewTarget(targets[1])
      latestController.togglePreserveFilePreviewTargets()
    })
    await act(async () => {
      renderer.update(createElement(ControllerHarness, {
        activeThreadId: 'thread-b',
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.openFilePreviewTargets).toEqual([targets[0], targets[1]])
  })

  it('restores persisted pin and preservation preferences after remounting', async () => {
    await act(async () => {
      latestController.openWorkspaceFilePreviewTarget(targets[0])
      latestController.togglePinnedFilePreviewTarget(targets[0])
      latestController.togglePreserveFilePreviewTargets()
      renderer.unmount()
    })
    await act(async () => {
      renderer = create(createElement(ControllerHarness, {
        activeThreadId: 'thread-a',
        rightPanelMode: 'extension:example/panel',
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.preserveFilePreviewTargets).toBe(true)
    expect(latestController.pinnedFilePreviewTargetKeys).toEqual([
      workspaceFileTargetKey(targets[0], 'linux')
    ])
  })

  it('treats an explicit collapse as authoritative for tabs and persisted pins', async () => {
    await act(async () => {
      latestController.openWorkspaceFilePreviewTarget(targets[0])
      latestController.togglePinnedFilePreviewTarget(targets[0])
      latestController.clearFilePreviewTargets()
    })
    expect(latestController.openFilePreviewTargets).toEqual([])
    expect(latestController.pinnedFilePreviewTargetKeys).toEqual([])
    expect(storage.getItem('kun.filePreview.pinnedTargets')).toBe('[]')
  })

  it('closes the file panel only when a switch leaves no retained file tabs', async () => {
    await act(async () => latestController.openWorkspaceFilePreviewTarget(targets[0]))
    setRightPanelMode.mockClear()
    await act(async () => {
      renderer.update(createElement(ControllerHarness, {
        activeThreadId: 'thread-b',
        rightPanelMode: BUILTIN_RIGHT_PANEL_IDS.file,
        onSetRightPanelMode: setRightPanelMode
      }))
    })
    expect(latestController.openFilePreviewTargets).toEqual([])
    expect(setRightPanelMode).toHaveBeenCalledWith(null)
  })
})
