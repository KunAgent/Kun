import { createElement, type ReactElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceOfficePreviewSuccess,
  WorkspacePresentationViewReference,
  WorkspacePresentationViewSource
} from '@shared/office-document'

const libraryMocks = vi.hoisted(() => ({ initPptx: vi.fn() }))

vi.mock('pptx-preview', () => ({ init: libraryMocks.initPptx }))

import { requestKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import { WorkspacePptxPreview } from './WorkspacePptxPreview'
import {
  createMockPptxPreviewer,
  type MockPptxPreviewer
} from './workspace-office-renderers-test-support'

function preview(name: string, sha: string): WorkspaceOfficePreviewSuccess {
  return {
    ok: true,
    path: `/repo/${name}`,
    name,
    sourceFormat: name.endsWith('.ppt') ? 'ppt' : 'pptx',
    renderFormat: 'pptx',
    viewer: 'presentation',
    size: 3,
    mtimeMs: 1,
    sourceSha256: sha,
    data: new Uint8Array([1, 2, 3])
  }
}

describe('WorkspacePptxPreview presentation view reporting', () => {
  let dom: JSDOM
  let renderer: ReactTestRenderer | undefined
  let additionalRenderers: ReactTestRenderer[]
  let instances: MockPptxPreviewer[]

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    dom = new JSDOM('<!doctype html><html><body></body></html>')
    vi.stubGlobal('window', Object.assign(dom.window, {
      kunGui: { openExternal: vi.fn(async () => undefined) }
    }))
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('Element', dom.window.Element)
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
    const browserWindow = dom.window as unknown as typeof globalThis
    vi.stubGlobal('Event', browserWindow.Event)
    vi.stubGlobal('KeyboardEvent', browserWindow.KeyboardEvent)
    Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    })
    instances = []
    additionalRenderers = []
    libraryMocks.initPptx.mockReset()
    libraryMocks.initPptx.mockImplementation((host: HTMLElement) => {
      const instance = createMockPptxPreviewer(host, 4)
      instances.push(instance)
      return instance
    })
  })

  afterEach(async () => {
    for (const additional of additionalRenderers) {
      await act(async () => additional.unmount())
    }
    if (renderer) await act(async () => renderer?.unmount())
    renderer = undefined
    dom.window.close()
    vi.unstubAllGlobals()
  })

  it('reports initial and navigated slides and source-scoped cleanup', async () => {
    const onPresentationViewChange = vi.fn()
    const sourceA = preview('deck.pptx', 'a'.repeat(64))
    await act(async () => {
      renderer = create(createElement(WorkspacePptxPreview, {
        result: sourceA,
        loading: false,
        onPresentationViewChange
      }), { createNodeMock })
      await flushPromises()
    })

    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      path: '/repo/deck.pptx',
      sourceSha256: 'a'.repeat(64),
      slide: 1,
      slideCount: 4
    }))
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Next slide' }).props.onClick())
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(2)

    await act(async () => requestKnowledgeSourceNavigation({
      filePath: sourceA.path,
      location: { kind: 'presentation', slideStart: 3, slideEnd: 3 }
    }))
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(3)
    await act(async () => renderer?.root.findByProps({ 'aria-label': 'Go to slide 4' }).props.onClick())
    expect(lastReportedView(onPresentationViewChange)?.slide).toBe(4)

    const sourceB = preview('deck.pptx', 'b'.repeat(64))
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: sourceB,
        loading: false,
        onPresentationViewChange
      }))
      await flushPromises()
    })
    expect(onPresentationViewChange).toHaveBeenCalledWith(null, {
      path: sourceA.path,
      sourceSha256: sourceA.sourceSha256
    })
    // A reload of the same deck (an edit landed) keeps the slide on screen.
    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      sourceSha256: sourceB.sourceSha256,
      slide: 4
    }))

    const otherDeck = preview('other.pptx', 'c'.repeat(64))
    await act(async () => {
      renderer?.update(createElement(WorkspacePptxPreview, {
        result: otherDeck,
        loading: false,
        onPresentationViewChange
      }))
      await flushPromises()
    })
    expect(lastReportedView(onPresentationViewChange)).toEqual(expect.objectContaining({
      path: '/repo/other.pptx',
      slide: 1
    }))

    await act(async () => renderer?.unmount())
    renderer = undefined
    expect(onPresentationViewChange).toHaveBeenCalledWith(null, {
      path: otherDeck.path,
      sourceSha256: otherDeck.sourceSha256
    })
  })

  it('applies global navigation keys only to the keyboard-active preview', async () => {
    const onPrimaryViewChange = vi.fn()
    const onSecondaryViewChange = vi.fn()
    const primary = preview('primary.pptx', 'a'.repeat(64))
    const secondary = preview('secondary.pptx', 'b'.repeat(64))
    const renderPreview = (
      result: WorkspaceOfficePreviewSuccess,
      keyboardActive: boolean,
      onPresentationViewChange: (
        view: WorkspacePresentationViewReference | null,
        source: WorkspacePresentationViewSource
      ) => void
    ) => createElement(WorkspacePptxPreview, {
      result,
      loading: false,
      keyboardActive,
      onPresentationViewChange
    })

    await act(async () => {
      renderer = create(renderPreview(primary, true, onPrimaryViewChange), { createNodeMock })
      await flushPromises()
    })
    let secondaryRenderer!: ReactTestRenderer
    await act(async () => {
      secondaryRenderer = create(renderPreview(secondary, false, onSecondaryViewChange), { createNodeMock })
      additionalRenderers.push(secondaryRenderer)
      await flushPromises()
    })
    expect(instances).toHaveLength(4)
    instances.forEach((instance) => instance.renderSingleSlide.mockClear())
    await dispatchKey('ArrowRight')
    expect(instances[0]!.renderSingleSlide).toHaveBeenCalledWith(1)
    expect(instances[2]!.renderSingleSlide).not.toHaveBeenCalled()
    expect(lastReportedView(onPrimaryViewChange)?.slide).toBe(2)
    expect(lastReportedView(onSecondaryViewChange)?.slide).toBe(1)

    await act(async () => {
      renderer?.update(renderPreview(primary, false, onPrimaryViewChange))
      secondaryRenderer.update(renderPreview(secondary, true, onSecondaryViewChange))
    })
    instances.forEach((instance) => instance.renderSingleSlide.mockClear())
    await dispatchKey('ArrowRight')
    expect(instances[0]!.renderSingleSlide).not.toHaveBeenCalled()
    expect(instances[2]!.renderSingleSlide).toHaveBeenCalledWith(1)
    expect(lastReportedView(onPrimaryViewChange)?.slide).toBe(2)
    expect(lastReportedView(onSecondaryViewChange)?.slide).toBe(2)
  })
})

function createNodeMock(element: ReactElement<unknown>): HTMLElement | null {
  if (typeof element.type !== 'string') return null
  const node = document.createElement(element.type)
  const props = element.props as Record<string, unknown>
  if (props['data-pptx-canvas-viewport'] === 'true') {
    Object.defineProperties(node, {
      clientWidth: { configurable: true, value: 1_200 },
      clientHeight: { configurable: true, value: 800 }
    })
  }
  return node
}

function lastReportedView(callback: ReturnType<typeof vi.fn>) {
  return callback.mock.calls.filter(([view]) => view != null).at(-1)?.[0]
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve()
}

async function dispatchKey(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await flushPromises()
  })
}
