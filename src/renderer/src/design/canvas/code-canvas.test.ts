import { describe, expect, it, vi } from 'vitest'
import { createDefaultShape, createEmptyDocument } from './canvas-types'
import { canvasDocumentKey } from './canvas-persistence'
import {
  CODE_CANVAS_DIR,
  codeCanvasArtifactId,
  codeCanvasThreadBaseDir,
  loadCodeCanvasDesignSystemForPrompt,
  resolveCodeCanvasComposerRoute,
  resolveCodeCanvasWorkspaceRoot,
  shouldRouteCodePromptToCanvas,
  shouldRouteOpenCodeWhiteboardPrompt,
  shouldSendPromptToCodeCanvas,
  snapshotCodeCanvasForPrompt
} from './code-canvas'
import type { DesignSystem } from './design-system-types'

function documentWithRect(name: string, id?: string) {
  const doc = createEmptyDocument()
  const root = doc.objects[doc.rootId]
  const rect = createDefaultShape('rect', 10, 20)
  if (id) rect.id = id
  rect.name = name
  doc.objects[rect.id] = { ...rect, parentId: doc.rootId }
  doc.objects[doc.rootId] = { ...root, children: [rect.id] }
  return doc
}

const baseOptions = {
  workspaceRoot: '/workspace',
  threadId: 'thread-1',
  selectedIds: new Set<string>(),
  viewBox: { x: 0, y: 0, width: 1200, height: 800 },
  defaultScreenSize: { width: 1280, height: 800 }
}

const threadDocumentKey = canvasDocumentKey(
  baseOptions.workspaceRoot,
  codeCanvasArtifactId(baseOptions.threadId),
  CODE_CANVAS_DIR
)

describe('shouldRouteCodePromptToCanvas', () => {
  it('detects explicit code whiteboard requests without catching ordinary coding prompts', () => {
    expect(shouldRouteCodePromptToCanvas('Draw a dependency graph for this module')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Map the API flow on the whiteboard')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Visualize the module dependencies for this package')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Draw the call graph from request handler to DB')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Create an ER diagram for the schema')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Sketch a class diagram for these models')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('\u753b\u4e2a\u67b6\u6784\u56fe')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('\u68b3\u7406\u4e00\u4e0b\u8c03\u7528\u94fe\u8def')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('\u753b\u4e00\u4e2a\u6a21\u5757\u4f9d\u8d56\u56fe')).toBe(true)
    expect(shouldRouteCodePromptToCanvas('Refactor this module and fix the tests')).toBe(false)
    expect(shouldRouteCodePromptToCanvas('Explain the system architecture in prose')).toBe(false)
    expect(shouldRouteCodePromptToCanvas('Fix the call graph traversal bug')).toBe(false)
    expect(shouldRouteCodePromptToCanvas('Fix the HTML canvas rendering bug')).toBe(false)
  })

  it('routes open-whiteboard edit references without hijacking normal code questions', () => {
    expect(shouldSendPromptToCodeCanvas({
      text: 'Draw a dependency graph for this module',
      whiteboardOpen: false
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Refactor this module and fix the tests',
      whiteboardOpen: true
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Fix the HTML canvas rendering bug',
      whiteboardOpen: true
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Move this node to the right',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Make it blue',
      whiteboardOpen: true,
      hasSelection: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Make it thread-safe',
      whiteboardOpen: true
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u628a\u8fd9\u4e2a\u8282\u70b9\u5f80\u53f3\u79fb\u4e00\u70b9',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u628a\u5b83\u6539\u6210\u84dd\u8272',
      whiteboardOpen: true,
      hasSelection: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5e2e\u6211\u751f\u6210\u4e00\u4e2a\u5c0f\u9e21\u7684\u56fe\u7247',
      whiteboardOpen: true,
      hasSelection: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Generate a chick image',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5e2e\u6211\u653e\u5230\u753b\u5e03\u4e0a',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5e2e\u6211\u653e\u7684\u753b\u5e03\u4e0a',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Put it on the canvas',
      whiteboardOpen: true,
      hasSelection: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Export this as a PNG',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u628a\u5b83\u8f6c\u6210\u56fe\u7247',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u7ed9\u6211\u751f\u6210png',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'PNG \u7248\u672c\u5c31\u884c',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u628a\u8fd9\u4e2a\u5bfc\u51fa',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Give me a PNG',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'SVG please',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5bfc\u51fa\u4e00\u4e0b',
      whiteboardOpen: true
    })).toBe(true)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Generate a PNG parser for this binary format',
      whiteboardOpen: true
    })).toBe(false)
  })

  it('does not treat open-whiteboard references as active when the whiteboard is closed', () => {
    expect(shouldSendPromptToCodeCanvas({
      text: 'Move this node to the right',
      whiteboardOpen: false
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5e2e\u6211\u751f\u6210\u4e00\u4e2a\u5c0f\u9e21\u7684\u56fe\u7247',
      whiteboardOpen: false,
      hasSelection: true
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u5e2e\u6211\u653e\u5230\u753b\u5e03\u4e0a',
      whiteboardOpen: false
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: 'Export this as a PNG',
      whiteboardOpen: false
    })).toBe(false)
    expect(shouldSendPromptToCodeCanvas({
      text: '\u7ed9\u6211\u751f\u6210png',
      whiteboardOpen: false
    })).toBe(false)
    expect(shouldRouteOpenCodeWhiteboardPrompt('Move this node to the right')).toBe(true)
  })

  it('resolves chat composer messages into code-canvas outbound context', () => {
    expect(resolveCodeCanvasComposerRoute({
      route: 'chat',
      composerMode: 'agent',
      userText: 'Draw a dependency graph',
      preparedText: 'Draw a dependency graph',
      emptyPrompt: 'Say something',
      whiteboardOpen: false
    })).toEqual({
      baseText: 'Draw a dependency graph',
      canvasBrief: 'Draw a dependency graph',
      displayText: 'Draw a dependency graph'
    })

    expect(resolveCodeCanvasComposerRoute({
      route: 'chat',
      composerMode: 'agent',
      userText: '',
      preparedText: 'Image-only prompt',
      preparedDisplayText: 'Image attached',
      emptyPrompt: 'Say something',
      whiteboardOpen: true,
      hasSelection: true
    })).toEqual({
      baseText: 'Image-only prompt',
      canvasBrief: 'Image attached',
      displayText: 'Image attached'
    })

    expect(resolveCodeCanvasComposerRoute({
      route: 'design',
      composerMode: 'agent',
      userText: 'Draw a graph',
      preparedText: 'Draw a graph',
      emptyPrompt: 'Say something',
      whiteboardOpen: true
    })).toBeNull()
    expect(resolveCodeCanvasComposerRoute({
      route: 'chat',
      composerMode: 'plan',
      userText: 'Draw a graph',
      preparedText: 'Draw a graph',
      emptyPrompt: 'Say something',
      whiteboardOpen: true
    })).toBeNull()
  })
})

describe('snapshotCodeCanvasForPrompt', () => {
  it('resolves the code canvas workspace from the active thread before falling back', () => {
    expect(resolveCodeCanvasWorkspaceRoot('/workspace/thread-project', '/workspace/global')).toBe(
      '/workspace/thread-project'
    )
    expect(resolveCodeCanvasWorkspaceRoot('  ', '/workspace/global')).toBe('/workspace/global')
    expect(resolveCodeCanvasWorkspaceRoot(null, ' /workspace/global ')).toBe('/workspace/global')
  })

  it('places per-thread code canvas data under the canvas document directory', () => {
    expect(codeCanvasThreadBaseDir('thread-1')).toBe(
      `${CODE_CANVAS_DIR}/${codeCanvasArtifactId('thread-1')}`
    )
  })

  it('falls back to the persisted thread canvas when the current store document is empty', async () => {
    const persistedDoc = documentWithRect('Persisted Card')
    const loadDocument = vi.fn(async () => persistedDoc)

    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: createEmptyDocument(),
      loadDocument
    })

    expect(loadDocument).toHaveBeenCalledWith(
      '/workspace',
      codeCanvasArtifactId('thread-1'),
      CODE_CANVAS_DIR
    )
    expect(snapshot?.shapeCount).toBe(1)
    expect(snapshot?.shapes[0].name).toBe('Persisted Card')
  })

  it('uses the current store document when it already has canvas content', async () => {
    const loadDocument = vi.fn(async () => documentWithRect('Persisted Card'))

    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: documentWithRect('Current Draft'),
      currentDocumentKey: threadDocumentKey,
      loadDocument
    })

    expect(loadDocument).not.toHaveBeenCalled()
    expect(snapshot?.shapeCount).toBe(1)
    expect(snapshot?.shapes[0].name).toBe('Current Draft')
  })

  it('ignores a non-matching current store document and loads the current thread canvas', async () => {
    const loadDocument = vi.fn(async () => documentWithRect('Persisted Current Thread'))

    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: documentWithRect('Stale Other Thread'),
      currentDocumentKey: canvasDocumentKey('/workspace', 'code-other-thread', CODE_CANVAS_DIR),
      loadDocument
    })

    expect(loadDocument).toHaveBeenCalledWith(
      '/workspace',
      codeCanvasArtifactId('thread-1'),
      CODE_CANVAS_DIR
    )
    expect(snapshot?.shapeCount).toBe(1)
    expect(snapshot?.shapes[0].name).toBe('Persisted Current Thread')
  })

  it('drops stale selection when falling back from a non-matching store document', async () => {
    const collidingId = 'shape-selection-collision'
    const loadDocument = vi.fn(async () => documentWithRect('Persisted Current Thread', collidingId))

    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: documentWithRect('Stale Other Thread', collidingId),
      currentDocumentKey: canvasDocumentKey('/workspace', 'code-other-thread', CODE_CANVAS_DIR),
      selectedIds: new Set([collidingId]),
      loadDocument
    })

    expect(snapshot?.shapeCount).toBe(1)
    expect(snapshot?.shapes[0].id).toBe(collidingId)
    expect(snapshot?.shapes[0].selected).toBeUndefined()
  })

  it('drops stale viewport hints when falling back from a non-matching store document', async () => {
    const loadDocument = vi.fn(async () => documentWithRect('Persisted Current Thread'))

    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: documentWithRect('Stale Other Thread'),
      currentDocumentKey: canvasDocumentKey('/workspace', 'code-other-thread', CODE_CANVAS_DIR),
      loadDocument
    })

    expect(snapshot?.shapeCount).toBe(1)
    expect(snapshot?.shapes[0].inView).toBeUndefined()
    expect(snapshot?.placement).toBeUndefined()
  })

  it('returns undefined when both current and persisted canvases are empty', async () => {
    const snapshot = await snapshotCodeCanvasForPrompt({
      ...baseOptions,
      currentDocument: createEmptyDocument(),
      loadDocument: vi.fn(async () => createEmptyDocument())
    })

    expect(snapshot).toBeUndefined()
  })
})

describe('loadCodeCanvasDesignSystemForPrompt', () => {
  it('loads the design system from the current code canvas thread directory', async () => {
    const system: DesignSystem = {
      tokens: {
        'brand/primary': { name: 'brand/primary', kind: 'color', value: '#14b8a6' }
      },
      components: {}
    }
    const loadSystem = vi.fn(async () => system)

    const loaded = await loadCodeCanvasDesignSystemForPrompt({
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      loadSystem
    })

    expect(loadSystem).toHaveBeenCalledWith('/workspace', codeCanvasThreadBaseDir('thread-1'))
    expect(loaded).toEqual(system)
  })

  it('falls back to an empty design system when none is persisted', async () => {
    const loaded = await loadCodeCanvasDesignSystemForPrompt({
      workspaceRoot: '/workspace',
      threadId: 'thread-1',
      loadSystem: vi.fn(async () => null)
    })

    expect(loaded).toEqual({ tokens: {}, components: {} })
  })
})
