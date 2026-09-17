import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDesignPersistenceCoordinatorForTests } from '../design/design-persistence-coordinator'
import {
  canSwitchCanvasEngine,
  clearExcalidrawRuntimeCacheForTests,
  createEmptyExcalidrawScene,
  excalidrawScenePath,
  isExcalidrawSceneEmpty,
  liveCanvasEngine,
  liveExcalidrawScene,
  loadExcalidrawScene,
  parseCanvasEngineRecord,
  parseExcalidrawScene,
  persistCanvasEngineRecord,
  persistExcalidrawScene,
  rememberLiveExcalidrawScene,
  resolveExcalidrawSceneForPrompt,
  serializeCanvasEngineRecord,
  serializeExcalidrawScene
} from './excalidraw-persistence'

afterEach(() => {
  clearDesignPersistenceCoordinatorForTests()
  clearExcalidrawRuntimeCacheForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('excalidraw persistence', () => {
  it('round-trips a scene and ignores deleted elements for emptiness', () => {
    const scene = {
      type: 'excalidraw' as const,
      version: 2 as const,
      source: 'kun',
      elements: [
        { id: 'a', type: 'rectangle', isDeleted: true },
        { id: 'b', type: 'text', text: 'Hello', isDeleted: false }
      ],
      appState: { viewBackgroundColor: '#fff', collaborators: { skip: true } },
      files: { file1: { mimeType: 'image/png', dataURL: 'data:image/png;base64,abc' } }
    }
    const parsed = parseExcalidrawScene(serializeExcalidrawScene(scene))
    expect(parsed).toMatchObject({
      type: 'excalidraw',
      version: 2,
      elements: scene.elements,
      files: scene.files
    })
    expect(parsed?.appState).not.toHaveProperty('collaborators')
    expect(isExcalidrawSceneEmpty(parsed)).toBe(false)
    expect(isExcalidrawSceneEmpty(createEmptyExcalidrawScene())).toBe(true)
    expect(isExcalidrawSceneEmpty({
      type: 'excalidraw',
      version: 2,
      elements: [{ type: 'rect', isDeleted: true }]
    })).toBe(true)
  })

  it('rejects invalid payloads and maps engine records', () => {
    expect(parseExcalidrawScene('{')).toBeNull()
    expect(parseExcalidrawScene(JSON.stringify({ type: 'other', version: 2, elements: [] }))).toBeNull()
    expect(parseCanvasEngineRecord('{"engine":"excalidraw"}')).toBe('excalidraw')
    expect(parseCanvasEngineRecord('{"engine":"unknown"}')).toBe('kun')
    expect(parseCanvasEngineRecord('not-json')).toBe('kun')
    expect(serializeCanvasEngineRecord('excalidraw')).toContain('"engine": "excalidraw"')
    expect(excalidrawScenePath('board-1', '.kun-whiteboards')).toBe('.kun-whiteboards/board-1/excalidraw.json')
  })

  it('debounces scene writes through the workspace file API', async () => {
    vi.useFakeTimers()
    const writeWorkspaceFile = vi.fn(async (_request: {
      workspaceRoot: string
      path: string
      content: string
    }) => ({ ok: true as const, path: 'x', savedAt: 't' }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile, readWorkspaceFile: vi.fn() } })
    persistExcalidrawScene('/work', 'board-1', '.kun-whiteboards', createEmptyExcalidrawScene())
    persistExcalidrawScene('/work', 'board-1', '.kun-whiteboards', {
      ...createEmptyExcalidrawScene(),
      elements: [{ id: 'n', type: 'text', text: 'Note' }]
    })
    expect(writeWorkspaceFile).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(writeWorkspaceFile).toHaveBeenCalledTimes(1)
    const payload = writeWorkspaceFile.mock.calls[0]?.[0]
    expect(payload).toMatchObject({
      workspaceRoot: '/work',
      path: '.kun-whiteboards/board-1/excalidraw.json'
    })
    expect(String(payload?.content)).toContain('Note')
  })

  it('loads a persisted scene and allows switching only while empty', async () => {
    const scene = serializeExcalidrawScene(createEmptyExcalidrawScene())
    vi.stubGlobal('window', {
      kunGui: {
        readWorkspaceFile: vi.fn(async () => ({
          ok: true as const, path: 'x', content: scene, size: scene.length, mtimeMs: 1, truncated: false
        }))
      }
    })
    await expect(loadExcalidrawScene('/work', 'board-1', '.kun-whiteboards')).resolves.toMatchObject({
      type: 'excalidraw',
      elements: []
    })
    expect(canSwitchCanvasEngine({
      currentEngine: 'kun', kunEmpty: true, excalidrawEmpty: false
    })).toBe(true)
    expect(canSwitchCanvasEngine({
      currentEngine: 'kun', kunEmpty: false, excalidrawEmpty: true
    })).toBe(false)
    expect(canSwitchCanvasEngine({
      currentEngine: 'excalidraw', kunEmpty: true, excalidrawEmpty: false
    })).toBe(false)
  })

  it('prefers the live scene cache for outbound prompts', async () => {
    rememberLiveExcalidrawScene('/work', 'board-live', '.kun-whiteboards', {
      type: 'excalidraw',
      version: 2,
      source: 'kun',
      elements: [{ id: 'box', type: 'rectangle', isDeleted: false }]
    })
    await expect(resolveExcalidrawSceneForPrompt('/work', 'board-live', '.kun-whiteboards'))
      .resolves.toMatchObject({ elements: [{ id: 'box' }] })
    expect(liveExcalidrawScene('/work', 'board-live', '.kun-whiteboards')?.elements).toHaveLength(1)
  })

  it('writes engine.json and prefers the live cache', async () => {
    const writeWorkspaceFile = vi.fn(async () => ({ ok: true as const, path: 'x', savedAt: 't' }))
    vi.stubGlobal('window', { kunGui: { writeWorkspaceFile, readWorkspaceFile: vi.fn() } })
    await persistCanvasEngineRecord('/work', '.kun-canvas/code-t/engine.json', 'excalidraw')
    expect(writeWorkspaceFile).toHaveBeenCalledWith(expect.objectContaining({
      path: '.kun-canvas/code-t/engine.json',
      content: expect.stringContaining('"engine": "excalidraw"')
    }))
    expect(liveCanvasEngine('/work', '.kun-canvas/code-t/engine.json')).toBe('excalidraw')
  })
})
