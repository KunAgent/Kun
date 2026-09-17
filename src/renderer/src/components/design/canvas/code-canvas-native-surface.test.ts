import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codeCanvasEnginePath } from '../../../design/canvas/code-canvas'
import {
  clearExcalidrawRuntimeCacheForTests,
  rememberLiveCanvasEngine
} from '../../../whiteboard/excalidraw-persistence'
import { CodeCanvasNativeSurface } from './code-canvas-native-surface'

vi.mock('./CanvasViewport', () => ({
  CanvasViewport: (props: { artifactId?: string; surface?: string }) =>
    createElement('canvas-viewport-stub', {
      'data-artifact-id': props.artifactId ?? '',
      'data-surface': props.surface ?? ''
    })
}))

vi.mock('./PropertiesPanel', () => ({
  PropertiesPanel: (props: { surface?: string }) =>
    createElement('properties-stub', { 'data-surface': props.surface ?? '' })
}))

vi.mock('../../../whiteboard/excalidraw-surface', () => ({
  ExcalidrawSurface: (props: { identityId?: string }) =>
    createElement('excalidraw-stub', { 'data-mock-excalidraw': props.identityId ?? '' }),
  CanvasEngineSwitcher: () => createElement('engine-switcher-stub', { 'data-canvas-engine-switcher': 'true' })
}))

vi.mock('../../../whiteboard/use-apply-excalidraw-live', () => ({
  useApplyExcalidrawLive: () => undefined
}))

vi.mock('../../../design/canvas/use-apply-shape-ops-live', () => ({
  useApplyShapeOpsLive: () => undefined
}))

vi.mock('../../../design/canvas/canvas-export', () => ({
  exportActiveCodeCanvasToWorkspace: async () => ({ ok: true })
}))

afterEach(() => {
  clearExcalidrawRuntimeCacheForTests()
})

describe('CodeCanvasNativeSurface', () => {
  it('hosts the Kun canvas and an empty-board engine switcher by default', () => {
    const html = renderToStaticMarkup(createElement(CodeCanvasNativeSurface, {
      workspaceRoot: '/workspace',
      threadId: 'thread-code'
    }))
    expect(html).toContain('data-canvas-engine="kun"')
    expect(html).toContain('data-surface="code"')
    expect(html).toContain('canvas-viewport-stub')
    expect(html).toContain('properties-stub')
    expect(html).toContain('data-canvas-engine-switcher="true"')
    expect(html).not.toContain('data-mock-excalidraw')
  })

  it('hosts Excalidraw instead of ShapeOps when the thread engine is excalidraw', () => {
    rememberLiveCanvasEngine('/workspace', codeCanvasEnginePath('thread-exo'), 'excalidraw')
    const html = renderToStaticMarkup(createElement(CodeCanvasNativeSurface, {
      workspaceRoot: '/workspace',
      threadId: 'thread-exo'
    }))
    expect(html).toContain('data-canvas-engine="excalidraw"')
    expect(html).toContain('data-mock-excalidraw="code-thread-exo"')
    expect(html).not.toContain('canvas-viewport-stub')
    expect(html).not.toContain('properties-stub')
    expect(html).toContain('data-canvas-engine-switcher="true"')
  })
})
