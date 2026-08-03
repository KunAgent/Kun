import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isJsonPreviewPath,
  nextFilePreviewTargetForWheel,
  parsePreviewScrollPositions,
  rememberPreviewScrollPosition,
  resolvedPreviewPathMatchesTarget,
  targetKey,
  WorkspaceFilePreviewPanel,
  svgPreviewDataUrl
} from './WorkspaceFilePreviewPanel'

const { openWorkspacePathInEditor } = vi.hoisted(() => ({
  openWorkspacePathInEditor: vi.fn(async () => ({ ok: true }))
}))

vi.mock('../lib/open-workspace-path', () => ({ openWorkspacePathInEditor }))
vi.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    filePreviewOpenFiles: 'Open files',
    filePreviewPinnedTab: 'Pinned tab',
    filePreviewCloseTab: 'Close tab',
    filePreviewPreserveAcrossThreads: 'Keep files',
    filePreviewEnterReadingMode: 'Expand reading view',
    filePreviewExitReadingMode: 'Exit reading view',
    filePreviewUnsupported: 'Unsupported',
    filePreviewEmpty: 'No file selected',
    filePreviewTitle: 'File preview',
    filePreviewOpenEditor: 'Open in editor',
    filePreviewOpenSystem: 'Open with system app',
    filePreviewRevealInFolder: 'Show in file manager',
    filePreviewCopyContent: 'Copy file',
    filePreviewRenderHtml: 'Render HTML',
    filePreviewShowSource: 'Show source',
    fileTreeOpen: 'Show file tree',
    fileTreeClose: 'Hide file tree',
    rightPanelCollapse: 'Collapse'
  }
  const t = (key: string) => labels[key] ?? key
  return { useTranslation: () => ({ t }) }
})

describe('HTML workspace preview', () => {
  it('opens HTML files in source view before rendering the sandboxed preview', async () => {
    vi.stubGlobal('window', {
      kunGui: {
        platform: 'linux',
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: '/repo/index.html',
          content: '<!doctype html><html><body><h1>Preview</h1><script>document.body.innerHTML = ""</script></body></html>',
          size: 103,
          mtimeMs: 100,
          truncated: false
        })),
        openWorkspacePreviewResource: vi.fn(async () => ({
          ok: true as const,
          leaseId: 'lease_1',
          url: 'kun-workspace-preview://lease/lease_1/index.html',
          mimeType: 'text/html; charset=utf-8',
          size: 103,
          mtimeMs: 100,
          expiresAt: '2026-07-30T00:00:00.000Z'
        })),
        releaseWorkspacePreviewResource: vi.fn(async () => ({ ok: true as const }))
      },
      innerWidth: 1200,
      innerHeight: 800,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      cancelAnimationFrame: vi.fn(),
      clearTimeout,
      setTimeout
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: { path: '/repo/index.html', workspaceRoot: '/repo' },
        workspaceRoot: '/repo',
        onClose: () => undefined
      }))
    })

    expect(renderer.root.findAllByType('iframe')).toHaveLength(0)
    expect(renderer.root.findAllByProps({ className: 'ds-file-preview-code-html' })).toHaveLength(1)

    const renderButton = renderer.root.findByProps({ 'aria-label': 'Render HTML' })
    expect(renderButton.props['aria-pressed']).toBe(false)

    await act(async () => renderButton.props.onClick())

    expect(renderer.root.findAllByType('iframe')).toHaveLength(1)
    expect(renderer.root.findByProps({ 'aria-label': 'Show source' }).props['aria-pressed']).toBe(true)
    await act(async () => renderer.unmount())
  })
})

const openTargets = [
  { path: '/repo/One.bin', workspaceRoot: '/repo' },
  { path: '/repo/two.bin', workspaceRoot: '/repo' }
]

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  openWorkspacePathInEditor.mockClear()
  vi.stubGlobal('window', {
    kunGui: { platform: 'linux' },
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    },
    cancelAnimationFrame: vi.fn(),
    clearTimeout,
    setTimeout
  })
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WorkspaceFilePreviewPanel toolbar', () => {
  it('keeps reading as an icon control and omits the code-to-design action', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanel, {
      target: { path: 'package.json' },
      workspaceRoot: '/workspace',
      onClose: () => {}
    }))

    expect(html).toContain('data-reading-mode="false"')
    expect(html).toContain('lucide-maximize-2')
    expect(html).not.toContain('lucide-palette')
    expect(html).not.toContain('kun-issue781-expand-button')
  })

  it('renders roving accessible tabs and persistent controls without nested buttons', () => {
    const pinnedKey = targetKey(openTargets[1], 'linux')
    const html = renderToStaticMarkup(createElement(WorkspaceFilePreviewPanel, {
      target: openTargets[0],
      openTargets,
      workspaceRoot: '/repo',
      pinnedTargetKeys: [pinnedKey],
      preserveAcrossThreads: true,
      onSelectTarget: () => undefined,
      onCloseTarget: () => undefined,
      onTogglePinnedTarget: () => undefined,
      onCloseOtherTargets: () => undefined,
      onTogglePreserveAcrossThreads: () => undefined,
      onClose: () => undefined
    }))

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab" tabindex="0" aria-selected="true"')
    expect(html).toContain('role="tab" tabindex="-1" aria-selected="false"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('lucide-pin')
    expect(html).not.toMatch(/role="tab"[^>]*>[^<]*<button/)
  })

  it('turns the folder action into an accessible file-tree toggle when provided', async () => {
    const onToggleFileTree = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: null,
        workspaceRoot: '/repo',
        fileTreeOpen: false,
        onToggleFileTree,
        onClose: () => undefined
      }))
    })

    const toggle = renderer.root.findByProps({ 'aria-label': 'Show file tree' })
    expect(toggle.props['aria-pressed']).toBe(false)
    expect(renderer.root.findAllByProps({ 'aria-label': 'Open with system app' })).toHaveLength(0)

    await act(async () => toggle.props.onClick())
    expect(onToggleFileTree).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })

  it('reveals the selected file in its workspace file manager', async () => {
    const revealWorkspaceFileInFolder = vi.fn(async () => ({ ok: true as const }))
    vi.stubGlobal('window', {
      kunGui: { platform: 'linux', revealWorkspaceFileInFolder },
      innerWidth: 1200,
      innerHeight: 800,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      cancelAnimationFrame: vi.fn(),
      clearTimeout,
      setTimeout
    })
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: { path: 'notes/plan.md', workspaceRoot: '/repo' },
        workspaceRoot: '/repo',
        onClose: () => undefined
      }))
    })

    await act(async () => {
      renderer.root.findByProps({ 'aria-label': 'Show in file manager' }).props.onClick()
    })

    expect(revealWorkspaceFileInFolder).toHaveBeenCalledWith({
      path: 'notes/plan.md',
      workspaceRoot: '/repo'
    })
    await act(async () => renderer.unmount())
  })
})

describe('WorkspaceFilePreviewPanel interactions', () => {
  it('opens the double-clicked inactive tab instead of the active target', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: openTargets[0],
        openTargets,
        workspaceRoot: '/repo',
        onSelectTarget: () => undefined,
        onTogglePinnedTarget: () => undefined,
        onClose: () => undefined
      }))
    })

    const tabs = renderer.root.findAllByProps({ role: 'tab' })
    await act(async () => tabs[1].props.onDoubleClick())
    expect(openWorkspacePathInEditor).toHaveBeenCalledWith(
      { path: '/repo/two.bin', line: undefined, column: undefined },
      '/repo'
    )
    await act(async () => renderer.unmount())
  })

  it('navigates tabs with the wheel and keeps reading mode while the target changes', async () => {
    const onSelectTarget = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: openTargets[0],
        openTargets,
        workspaceRoot: '/repo',
        onSelectTarget,
        onClose: () => undefined
      }))
    })
    const preventDefault = vi.fn()
    await act(async () => {
      renderer.root.findByProps({ role: 'tablist' }).props.onWheel({
        deltaY: 1,
        deltaX: 0,
        currentTarget: {
          scrollWidth: 300,
          clientWidth: 300,
          scrollLeft: 0
        },
        preventDefault
      })
    })
    expect(preventDefault).toHaveBeenCalled()
    expect(onSelectTarget).toHaveBeenCalledWith(openTargets[1])

    const readingButton = renderer.root.findAllByType('button').find(
      (button) => button.props['aria-pressed'] === false
    )!
    await act(async () => readingButton.props.onClick())
    expect(renderer.root.findByType('aside').props['data-reading-mode']).toBe('true')

    await act(async () => {
      renderer.update(createElement(WorkspaceFilePreviewPanel, {
        target: openTargets[1],
        openTargets,
        workspaceRoot: '/repo',
        onSelectTarget,
        onClose: () => undefined
      }))
    })
    expect(renderer.root.findByType('aside').props['data-reading-mode']).toBe('true')
    await act(async () => renderer.unmount())
  })

  it('scrolls overflowing tabs with the wheel instead of changing the active file', async () => {
    const onSelectTarget = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: openTargets[0],
        openTargets,
        workspaceRoot: '/repo',
        onSelectTarget,
        onClose: () => undefined
      }))
    })

    const preventDefault = vi.fn()
    const tablist = renderer.root.findByProps({ role: 'tablist' })
    const currentTarget = {
      scrollWidth: 900,
      clientWidth: 300,
      scrollLeft: 10
    }
    await act(async () => {
      tablist.props.onWheel({
        deltaY: 40,
        deltaX: 0,
        currentTarget,
        preventDefault
      })
    })

    expect(preventDefault).toHaveBeenCalled()
    expect(currentTarget.scrollLeft).toBe(50)
    expect(onSelectTarget).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})

describe('file preview navigation and scroll memory', () => {
  it('matches loaded paths to relative targets without accepting stale results', () => {
    expect(resolvedPreviewPathMatchesTarget(
      '/repo/docs/one.md',
      { path: 'docs/one.md', workspaceRoot: '/repo' },
      '/fallback',
      'linux'
    )).toBe(true)
    expect(resolvedPreviewPathMatchesTarget(
      '/repo/docs/old.md',
      { path: 'docs/one.md', workspaceRoot: '/repo' },
      '/fallback',
      'linux'
    )).toBe(false)
  })

  it('wraps wheel navigation around the open target list', () => {
    expect(nextFilePreviewTargetForWheel(openTargets, openTargets[0], -1)).toEqual(openTargets[1])
    expect(nextFilePreviewTargetForWheel(openTargets, openTargets[1], 1)).toEqual(openTargets[0])
  })

  it('updates recency and bounds persisted scroll positions', () => {
    let positions: Record<string, number> = {}
    for (let index = 0; index < 205; index += 1) {
      positions = rememberPreviewScrollPosition(positions, `file-${index}`, index)
    }
    positions = rememberPreviewScrollPosition(positions, 'file-5', 900)

    expect(Object.keys(positions)).toHaveLength(200)
    expect(positions['file-5']).toBe(900)
    expect(Object.keys(positions).at(-1)).toBe('file-5')
  })

  it('migrates reversible Windows scroll keys and rejects lossy POSIX legacy keys', () => {
    const raw = JSON.stringify({
      'c:/active\nc:/repo\nc:/repo/One.md': 120,
      'c:/repo\nc:/repo/two.md': 240,
      broken: -1
    })
    expect(parsePreviewScrollPositions(raw, 'win32')).toEqual({
      'c:/repo\nc:/repo/one.md': 120,
      'c:/repo\nc:/repo/two.md': 240
    })
    expect(parsePreviewScrollPositions(raw, 'linux')).toEqual({
      'c:/repo\nc:/repo/two.md': 240
    })
  })
})

describe('JSON workspace preview', () => {
  it('recognizes JSON files case-insensitively', () => {
    expect(isJsonPreviewPath('/repo/package.json')).toBe(true)
    expect(isJsonPreviewPath('/repo/CONFIG.JSON')).toBe(true)
    expect(isJsonPreviewPath('/repo/config.json.bak')).toBe(false)
  })

  it('edits JSON through the shared text editor and saves with its disk version', async () => {
    const writeWorkspaceFile = vi.fn(async (payload: { path: string }) => ({
      ok: true as const,
      path: payload.path,
      savedAt: new Date().toISOString(),
      mtimeMs: 200
    }))
    vi.stubGlobal('window', {
      kunGui: {
        platform: 'linux',
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const,
          path: '/repo/package.json',
          content: '{\n  "name": "before"\n}',
          size: 22,
          mtimeMs: 100,
          truncated: false
        })),
        writeWorkspaceFile
      },
      innerWidth: 1200,
      innerHeight: 800,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        callback(0)
        return 1
      },
      cancelAnimationFrame: vi.fn(),
      clearTimeout,
      setTimeout
    })

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(WorkspaceFilePreviewPanel, {
        target: { path: '/repo/package.json', workspaceRoot: '/repo' },
        workspaceRoot: '/repo',
        onClose: () => undefined
      }))
    })

    const editButton = renderer.root.findAllByType('button').find(
      (button) => button.props['aria-label'] === 'filePreviewEditText'
    )!
    await act(async () => editButton.props.onClick())
    const editor = renderer.root.findByType('textarea')
    await act(async () => editor.props.onChange({ target: { value: '{\n  "name": "after"\n}' } }))
    const saveButton = renderer.root.findAllByType('button').find(
      (button) => button.props['aria-label'] === 'filePreviewSaveText'
    )!
    await act(async () => saveButton.props.onClick())

    expect(writeWorkspaceFile).toHaveBeenCalledWith({
      path: '/repo/package.json',
      workspaceRoot: '/repo',
      content: '{\n  "name": "after"\n}',
      expectedMtimeMs: 100
    })
    await act(async () => renderer.unmount())
  })
})

describe('SVG workspace preview', () => {
  it('encodes SVG markup as an image data URL instead of injecting it into the DOM', () => {
    const dataUrl = svgPreviewDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><text>你好 #1</text></svg>')

    expect(dataUrl).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
    expect(decodeURIComponent(dataUrl.split(',')[1])).toContain('<text>你好 #1</text>')
  })
})
