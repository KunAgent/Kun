import { describe, expect, it } from 'vitest'
import {
  buildDesignCanvasLocalTools,
  DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
  DESIGN_OPEN_EXCALIDRAW_TOOL_NAME
} from './design-canvas-tool.js'
import {
  createDesignApplyExcalidrawTool,
  createDesignOpenExcalidrawTool
} from './design-excalidraw-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

function context(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...overrides
  }
}

const workContext = () => context({ agentSurface: 'write' })
const excalidrawContext = () => context({ guiExcalidrawCanvas: true })
const roomContext = () => context({ guiRoomExcalidrawCanvas: true, agentSurface: 'code' })

describe('design_apply_excalidraw tool', () => {
  it('advertises on Excalidraw canvas turns and on the Work surface', () => {
    const tool = createDesignApplyExcalidrawTool()
    expect(tool.name).toBe(DESIGN_APPLY_EXCALIDRAW_TOOL_NAME)
    expect(tool.shouldAdvertise?.(excalidrawContext())).toBe(true)
    expect(tool.shouldAdvertise?.(workContext())).toBe(true)
    expect(tool.shouldAdvertise?.(context())).toBe(false)
    expect(tool.shouldAdvertise?.(context({ agentSurface: 'code' }))).toBe(false)
    expect(tool.shouldAdvertise?.(context({ guiDesignCanvas: true }))).toBe(false)
    expect(tool.description).toContain('excalidraw.png')
    expect(tool.description).toContain('design_open_excalidraw')
  })

  it('emits an apply-excalidraw op and echoes the boardId', async () => {
    const tool = createDesignApplyExcalidrawTool()
    const result = await tool.execute({ boardId: 'arch-map' }, workContext())
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
      action: 'apply_excalidraw',
      status: 'accepted',
      boardId: 'arch-map',
      surface: 'write',
      receiptKey: expect.stringMatching(/^design-receipt-[a-f0-9]{32}$/),
      ops: [{ op: 'apply-excalidraw', boardId: 'arch-map' }]
    })
  })

  it('stamps the originating surface so stale mounts cannot claim the request', async () => {
    const tool = createDesignApplyExcalidrawTool()
    const onCode = await tool.execute({}, context({ guiExcalidrawCanvas: true, agentSurface: 'code' }))
    expect(onCode.output).toMatchObject({ status: 'accepted', surface: 'code' })
    const unstamped = await tool.execute({}, context({ guiExcalidrawCanvas: true }))
    expect(unstamped.output).not.toMatchObject({ surface: expect.anything() })
  })

  it('omits boardId when the conversation board is implied', async () => {
    const tool = createDesignApplyExcalidrawTool()
    const result = await tool.execute({}, workContext())
    expect(result.output).toMatchObject({
      status: 'accepted',
      ops: [{ op: 'apply-excalidraw' }]
    })
    expect(result.output).not.toMatchObject({ boardId: expect.anything() })
  })

  it('rejects malformed board ids', async () => {
    const tool = createDesignApplyExcalidrawTool()
    for (const boardId of ['bad id', 'x'.repeat(65), 'a/b', 'a.b', '中文']) {
      const result = await tool.execute({ boardId }, workContext())
      expect(result.isError).toBe(true)
      expect(result.output).toMatchObject({
        ok: false,
        error: 'boardId must match ^[a-zA-Z0-9_-]{1,64}$'
      })
    }
  })

  it('rejects a boardId outside the Work surface', async () => {
    const tool = createDesignApplyExcalidrawTool()
    const result = await tool.execute({ boardId: 'arch-map' }, excalidrawContext())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      ok: false,
      error: 'boardId targets a Work whiteboard and is only supported on the Work surface'
    })
  })
})

describe('design_open_excalidraw tool', () => {
  it('advertises only on the Work surface', () => {
    const tool = createDesignOpenExcalidrawTool()
    expect(tool.name).toBe(DESIGN_OPEN_EXCALIDRAW_TOOL_NAME)
    expect(tool.shouldAdvertise?.(workContext())).toBe(true)
    expect(tool.shouldAdvertise?.(excalidrawContext())).toBe(false)
    expect(tool.shouldAdvertise?.(context())).toBe(false)
    expect(tool.description).toContain('.kun-whiteboards/<boardId>/excalidraw.json')
    expect(tool.description).toContain('design_apply_excalidraw')
  })

  it('emits an open-excalidraw op with boardId and title', async () => {
    const tool = createDesignOpenExcalidrawTool()
    const result = await tool.execute({ boardId: 'auth-flow', title: 'Auth flow' }, workContext())
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_OPEN_EXCALIDRAW_TOOL_NAME,
      action: 'open_excalidraw',
      status: 'accepted',
      boardId: 'auth-flow',
      title: 'Auth flow',
      surface: 'write',
      receiptKey: expect.stringMatching(/^design-receipt-[a-f0-9]{32}$/),
      ops: [{ op: 'open-excalidraw', boardId: 'auth-flow', title: 'Auth flow' }]
    })
  })

  it('emits a bare open-excalidraw op when nothing is requested', async () => {
    const tool = createDesignOpenExcalidrawTool()
    const result = await tool.execute({}, workContext())
    expect(result.output).toMatchObject({
      status: 'accepted',
      ops: [{ op: 'open-excalidraw' }]
    })
    expect(result.output).not.toMatchObject({ boardId: expect.anything() })
  })

  it('rejects malformed board ids', async () => {
    const tool = createDesignOpenExcalidrawTool()
    const result = await tool.execute({ boardId: 'bad/id' }, workContext())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      ok: false,
      error: 'boardId must match ^[a-zA-Z0-9_-]{1,64}$'
    })
  })
})

describe('room Excalidraw tool surface', () => {
  it('advertises open and apply on a writable GUI private-chat room', () => {
    expect(createDesignOpenExcalidrawTool().shouldAdvertise?.(roomContext())).toBe(true)
    expect(createDesignApplyExcalidrawTool().shouldAdvertise?.(roomContext())).toBe(true)
    expect(createDesignOpenExcalidrawTool().shouldAdvertise?.(excalidrawContext())).toBe(false)
  })

  it('resolves a default board id and returns host-scoped paths for a room', async () => {
    const open = await createDesignOpenExcalidrawTool().execute({}, roomContext())
    expect(open.output).toMatchObject({
      status: 'accepted',
      boardId: 'room-61a1b52f6553',
      surface: 'room',
      scope: 'room',
      workspaceRoot: '/tmp/workspace',
      scenePath: '.kun-whiteboards/room-61a1b52f6553/excalidraw.json',
      pngPath: '.kun-whiteboards/room-61a1b52f6553/excalidraw.png'
    })
  })

  it('allows an explicit boardId on a room and keeps the receipt deterministic', async () => {
    const apply = await createDesignApplyExcalidrawTool().execute({ boardId: 'arch-map' }, roomContext())
    expect(apply.isError).toBeUndefined()
    expect(apply.output).toMatchObject({
      status: 'accepted',
      boardId: 'room-61a1b52f6553-arch-map',
      scope: 'room',
      surface: 'room',
      scenePath: '.kun-whiteboards/room-61a1b52f6553-arch-map/excalidraw.json',
      pngPath: '.kun-whiteboards/room-61a1b52f6553-arch-map/excalidraw.png',
      ops: [{ op: 'apply-excalidraw', boardId: 'room-61a1b52f6553-arch-map' }]
    })
  })
})

describe('design canvas tool registry', () => {
  it('registers the open tool in the local tool bundle', () => {
    const names = buildDesignCanvasLocalTools().map((tool) => tool.name)
    expect(names).toContain(DESIGN_APPLY_EXCALIDRAW_TOOL_NAME)
    expect(names).toContain(DESIGN_OPEN_EXCALIDRAW_TOOL_NAME)
  })
})
