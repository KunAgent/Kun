import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHtmlFrameShape, type CanvasShape } from '../../../../design/canvas/canvas-types'
import { useDesignWorkspaceStore } from '../../../../design/design-workspace-store'
import { useChatStore } from '../../../../store/chat-store'
import type { StartDesignHtmlPreviewWatchOptions } from '../../../../design/design-preview-file'
import { useHtmlFrameThumbnails } from './use-html-frame-thumbnails'

const watches = vi.hoisted(() => new Map<string, StartDesignHtmlPreviewWatchOptions>())
vi.mock('../../../../design/design-preview-file', () => ({
  startDesignHtmlPreviewWatch: (options: StartDesignHtmlPreviewWatchOptions) => {
    watches.set(options.path, options)
    options.onPreviewStateChange?.('renderable')
    options.onRevision(1)
    return () => { watches.delete(options.path) }
  }
}))
const frame = createHtmlFrameShape('Board', 0, 0, 'artifact', 'mobile')

describe('thumbnail source lifecycle', () => {
  let renderer: ReactTestRenderer | undefined
  let output!: ReturnType<typeof useHtmlFrameThumbnails>
  const Harness = ({ frames = [frame], workspace = '/workspace' }: { frames?: CanvasShape[]; workspace?: string }) => {
    output = useHtmlFrameThumbnails(frames, workspace)
    return null
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    watches.clear()
    useChatStore.setState({ busy: false })
    useDesignWorkspaceStore.setState({
      artifacts: [{ id: 'artifact', kind: 'html', title: 'Board', relativePath: 'board.html',
        createdAt: '2026-01-01', updatedAt: '2026-01-01', versions: [], previewStatus: 'ready' }],
      parallelPageStates: {}, pagesRun: null
    })
  })
  afterEach(async () => { if (renderer) await act(async () => renderer?.unmount()); renderer = undefined })

  it('invalidates changed files and rejects late capture results from old revisions', async () => {
    await act(async () => { renderer = create(createElement(Harness, {})) })
    const firstKey = output.thumbnails.get(frame.id)!.key
    expect(output.thumbnails.get(frame.id)?.pending).toBe(true)
    await act(async () => output.onCapture(frame.id, firstKey, 'image1'))
    expect(output.thumbnails.get(frame.id)?.image).toBe('image1')
    await act(async () => watches.get('board.html')!.onRevision(2))
    const next = output.thumbnails.get(frame.id)!
    expect(next.key).not.toBe(firstKey)
    expect(next.pending).toBe(true)
    expect(next.image).toBeUndefined()
    await act(async () => output.onCapture(frame.id, firstKey, 'stale'))
    expect(output.thumbnails.get(frame.id)?.image).toBeUndefined()
  })

  it('does not spend capture slots on generating boards and resumes when generation settles', async () => {
    useDesignWorkspaceStore.setState({ parallelPageStates: { artifact: { status: 'running' } } as never })
    await act(async () => { renderer = create(createElement(Harness, {})) })
    expect(output.thumbnails.get(frame.id)?.pending).toBe(false)
    await act(async () => watches.get('board.html')!.onRevision(2))
    expect(output.thumbnails.get(frame.id)?.pending).toBe(false)
    await act(async () => useDesignWorkspaceStore.setState({ parallelPageStates: {} }))
    expect(output.thumbnails.get(frame.id)?.pending).toBe(true)
  })

  it('retries missing captures on re-entry and cleans up file watches', async () => {
    await act(async () => { renderer = create(createElement(Harness, {})) })
    await act(async () => output.onCapture(frame.id, output.thumbnails.get(frame.id)!.key, null))
    expect(output.thumbnails.get(frame.id)?.pending).toBe(false)
    await act(async () => renderer?.update(createElement(Harness, { frames: [] })))
    expect(watches.size).toBe(0)
    await act(async () => renderer?.update(createElement(Harness, { frames: [frame] })))
    expect(output.thumbnails.get(frame.id)?.pending).toBe(true)
  })

  it('never reuses cached images across workspaces', async () => {
    await act(async () => { renderer = create(createElement(Harness, {})) })
    const old = output.thumbnails.get(frame.id)!.key
    await act(async () => output.onCapture(frame.id, old, 'old workspace'))
    await act(async () => renderer?.update(createElement(Harness, { workspace: '/other' })))
    expect(output.thumbnails.get(frame.id)?.image).toBeUndefined()
    await act(async () => output.onCapture(frame.id, old, 'late old workspace'))
    expect(output.thumbnails.get(frame.id)?.image).toBeUndefined()
  })
})
