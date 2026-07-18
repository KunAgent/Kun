import { describe, expect, it } from 'vitest'
import {
  createDesignCanvasTool,
  createDesignCreateScreenTool,
  createDesignExportCanvasTool,
  createDesignSvgCreateTool,
  createDesignSystemTemplateTool,
  createDesignUpdateShapesTool,
  createDesignValidateTool,
  DESIGN_CANVAS_TOOL_NAME,
  DESIGN_CREATE_SCREEN_TOOL_NAME,
  DESIGN_EXPORT_CANVAS_TOOL_NAME,
  DESIGN_SVG_CREATE_TOOL_NAME,
  DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
  DESIGN_UPDATE_SHAPES_MAX_OPS,
  DESIGN_UPDATE_SHAPES_TOOL_NAME,
  DESIGN_VALIDATE_TOOL_NAME
} from './design-canvas-tool.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { LocalToolHost } from './local-tool-host.js'

function context(guiDesignCanvas = true): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'danger-full-access',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    ...(guiDesignCanvas ? { guiDesignCanvas: true } : {})
  }
}

describe('design_canvas tool', () => {
  it('is advertised only for design canvas turns', () => {
    const tool = createDesignCanvasTool()
    expect(tool.name).toBe(DESIGN_CANVAS_TOOL_NAME)
    expect(tool.description).toContain('Code-mode sidebar whiteboard')
    expect(JSON.stringify(tool.inputSchema)).toContain('Code whiteboard creates an editable frame')
    expect(JSON.stringify(tool.inputSchema)).toContain('inspect the current canvas snapshot')
    expect(JSON.stringify(tool.inputSchema)).toContain('non-overlapping slot')
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
    expect(tool.shouldAdvertise?.(context(false))).toBe(false)
  })

  it('normalizes add_screen calls to renderer shape ops', async () => {
    const tool = createDesignCanvasTool()
    const result = await tool.execute(
      {
        action: 'add_screen',
        name: 'Home',
        brief: 'Mobile app home',
        devicePreset: 'mobile',
        width: 390,
        height: 844
      },
      context()
    )
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      action: 'add_screen',
      ops: [
        {
          op: 'add-screen',
          name: 'Home',
          brief: 'Mobile app home',
          devicePreset: 'mobile',
          width: 390,
          height: 844
        }
      ]
    })
  })

  it('returns update_shapes ops unchanged for the renderer to validate', async () => {
    const tool = createDesignCanvasTool()
    const op = { op: 'add', shape: { type: 'rect', width: 40, height: 40 } }
    const result = await tool.execute({ action: 'update_shapes', ops: [op] }, context())
    expect(result.output).toMatchObject({
      ok: true,
      action: 'update_shapes',
      ops: [op]
    })
  })

  it('rejects malformed update_shapes calls', async () => {
    const tool = createDesignCanvasTool()
    const result = await tool.execute({ action: 'update_shapes' }, context())
    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      ok: false,
      error: 'update_shapes requires ops as an object or array'
    })
  })
})

describe('dedicated design tools', () => {
  it('queues a deterministic renderer-backed whiteboard image export only in Code canvas turns', async () => {
    const tool = createDesignExportCanvasTool()
    expect(tool.name).toBe(DESIGN_EXPORT_CANVAS_TOOL_NAME)
    expect(tool.toolKind).toBe('file_change')
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
    expect(tool.shouldAdvertise?.({ ...context(true), guiDesignMode: true })).toBe(false)
    expect(tool.shouldAdvertise?.(context(false))).toBe(false)
    expect(tool.description).toContain('design_update_shapes first')
    expect(tool.description).toContain('call this tool directly without redrawing it')

    const result = await tool.execute({ name: '支付架构图' }, context(true))
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_EXPORT_CANVAS_TOOL_NAME,
      action: 'export_canvas',
      exportRequest: {
        format: 'png',
        fileName: expect.stringMatching(/^kun-whiteboard-[a-f0-9]{12}\.png$/),
        relativePath: expect.stringMatching(/^\.deepseekgui-images\/kun-whiteboard-[a-f0-9]{12}\.png$/)
      },
      generatedFiles: [{
        name: expect.stringMatching(/\.png$/),
        relativePath: expect.stringMatching(/^\.deepseekgui-images\/.+\.png$/),
        mimeType: 'image/png'
      }],
      ops: []
    })

    const replay = await tool.execute({ name: '支付架构图' }, context(true))
    expect((replay.output as { exportRequest: { relativePath: string } }).exportRequest.relativePath)
      .toBe((result.output as { exportRequest: { relativePath: string } }).exportRequest.relativePath)
  })

  it('supports SVG export and is hidden by a read-only sandbox', async () => {
    const tool = createDesignExportCanvasTool()
    const result = await tool.execute({ format: 'svg', name: 'API map.svg' }, context(true))
    expect(result.output).toMatchObject({
      exportRequest: {
        format: 'svg',
        fileName: expect.stringMatching(/^API-map-[a-f0-9]{12}\.svg$/)
      },
      generatedFiles: [{ mimeType: 'image/svg+xml' }]
    })

    const host = new LocalToolHost({ tools: [tool] })
    const names = (await host.listTools({
      ...context(true),
      sandboxMode: 'read-only'
    })).map((candidate) => candidate.name)
    expect(names).not.toContain(DESIGN_EXPORT_CANVAS_TOOL_NAME)
  })

  it('infers the export format from a filename extension when format is omitted', async () => {
    const tool = createDesignExportCanvasTool()
    const inferred = await tool.execute({ name: 'API map.svg' }, context(true))
    expect(inferred.output).toMatchObject({
      exportRequest: {
        format: 'svg',
        fileName: expect.stringMatching(/^API-map-[a-f0-9]{12}\.svg$/)
      },
      generatedFiles: [{ mimeType: 'image/svg+xml' }]
    })

    const explicit = await tool.execute({ format: 'png', name: 'API map.svg' }, context(true))
    expect(explicit.output).toMatchObject({
      exportRequest: {
        format: 'png',
        fileName: expect.stringMatching(/^API-map-[a-f0-9]{12}\.png$/)
      },
      generatedFiles: [{ mimeType: 'image/png' }]
    })
  })

  it('executes the export through the real local tool host in workspace-write mode', async () => {
    const host = new LocalToolHost({ tools: [createDesignExportCanvasTool()] })
    const toolContext = { ...context(true), sandboxMode: 'workspace-write' as const }
    const listed = await host.listTools(toolContext)
    expect(listed.map((tool) => tool.name)).toContain(DESIGN_EXPORT_CANVAS_TOOL_NAME)

    const result = await host.execute({
      callId: 'call_export_1',
      toolName: DESIGN_EXPORT_CANVAS_TOOL_NAME,
      arguments: { format: 'png', name: 'service-map' }
    }, toolContext)
    expect(result.item).toMatchObject({
      kind: 'tool_result',
      isError: false,
      output: {
        ok: true,
        action: 'export_canvas',
        generatedFiles: [{
          relativePath: expect.stringMatching(/^\.deepseekgui-images\/service-map-.+\.png$/),
          mimeType: 'image/png'
        }]
      }
    })
  })

  it('creates a first-class SVG handoff only for product Design turns', async () => {
    const tool = createDesignSvgCreateTool()
    const designContext = { ...context(true), guiDesignMode: true }
    expect(tool.name).toBe(DESIGN_SVG_CREATE_TOOL_NAME)
    expect(tool.toolKind).toBe('file_change')
    expect(tool.shouldAdvertise?.(designContext)).toBe(true)
    expect(tool.shouldAdvertise?.(context(true))).toBe(false)
    expect(tool.shouldAdvertise?.({ ...designContext, guiDesignCanvas: undefined })).toBe(false)

    const result = await tool.execute({
      name: 'Orbit loader',
      brief: 'A compact looping vector loader',
      width: 240,
      height: 160
    }, designContext)
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_SVG_CREATE_TOOL_NAME,
      ops: [{
        op: 'add-svg-artifact',
        artifactId: expect.stringMatching(/^svg-[a-f0-9]{12}$/),
        name: 'Orbit loader',
        brief: 'A compact looping vector loader',
        width: 240,
        height: 160
      }]
    })

    const replay = await tool.execute({
      name: 'Orbit loader',
      brief: 'A compact looping vector loader',
      width: 240,
      height: 160
    }, designContext)
    expect((replay.output as { ops: Array<{ artifactId: string }> }).ops[0]?.artifactId)
      .toBe((result.output as { ops: Array<{ artifactId: string }> }).ops[0]?.artifactId)
  })

  it('does not advertise renderer-backed SVG creation in a read-only sandbox', async () => {
    const host = new LocalToolHost({ tools: [createDesignSvgCreateTool()] })
    const names = (await host.listTools({
      ...context(true),
      guiDesignMode: true,
      sandboxMode: 'read-only'
    })).map((tool) => tool.name)
    expect(names).not.toContain(DESIGN_SVG_CREATE_TOOL_NAME)
  })

  it('normalizes design_create_screen calls to screen ops', async () => {
    const tool = createDesignCreateScreenTool()
    expect(tool.name).toBe(DESIGN_CREATE_SCREEN_TOOL_NAME)
    expect(tool.shouldAdvertise?.(context(true))).toBe(true)
    expect(JSON.stringify(tool.inputSchema)).toContain('Web -> desktop 1280x800')
    expect(JSON.stringify(tool.inputSchema)).toContain('App -> mobile 390x844')
    expect(JSON.stringify(tool.inputSchema)).toContain('Omit it unless the user asks for a custom size')
    expect(JSON.stringify(tool.inputSchema)).toContain('omitted dimensions follow the current Design target')
    expect(JSON.stringify(tool.inputSchema)).toContain('avoid existing shapes, images, frames')
    expect(tool.description).toContain('current canvas snapshot')
    expect(tool.description).toContain('do not cover existing images or frames')
    expect(tool.description).toContain('Code-mode whiteboard creates plain editable frame shapes')
    expect(JSON.stringify(tool.inputSchema)).toContain('Code-mode whiteboard keeps it as frame context only')
    const result = await tool.execute(
      { name: 'Home', brief: 'Dashboard home', devicePreset: 'desktop' },
      context()
    )
    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_CREATE_SCREEN_TOOL_NAME,
      ops: [{ op: 'add-screen', name: 'Home', brief: 'Dashboard home', devicePreset: 'desktop' }]
    })
  })

  it('normalizes design_update_shapes calls to renderer ops', async () => {
    const tool = createDesignUpdateShapesTool()
    expect(tool.name).toBe(DESIGN_UPDATE_SHAPES_TOOL_NAME)
    expect(JSON.stringify(tool.inputSchema)).toContain('direct top-level ShapeOp')
    expect(tool.description).toContain('inspect the current canvas snapshot first')
    expect(tool.description).toContain('20-50')
    expect(JSON.stringify(tool.inputSchema)).toContain(`"maxItems":${DESIGN_UPDATE_SHAPES_MAX_OPS}`)
    const op = { op: 'add', shape: { type: 'rect', width: 40, height: 40 } }
    const result = await tool.execute({ ops: op }, context())
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [op]
    })
  })

  it('enforces design_update_shapes operation and structural budgets', async () => {
    const tool = createDesignUpdateShapesTool()
    const validOps = Array.from({ length: 50 }, (_, index) => ({
      op: 'add', shape: { id: `shape_${index}`, type: 'rect', width: 10, height: 10 }
    }))
    const valid = await tool.execute({ ops: validOps }, context())
    expect(valid.isError).toBeUndefined()
    expect(valid.output).toMatchObject({ ok: true, ops: validOps })

    const oversized = await tool.execute({
      ops: Array.from({ length: DESIGN_UPDATE_SHAPES_MAX_OPS + 1 }, (_, index) => ({
        op: 'delete', id: `shape_${index}`
      }))
    }, context())
    expect(oversized.isError).toBe(true)
    expect(oversized.output).toMatchObject({
      ok: false,
      error: expect.stringContaining(`at most ${DESIGN_UPDATE_SHAPES_MAX_OPS} operations`)
    })

    let nested: Record<string, unknown> = { value: true }
    for (let depth = 0; depth < 40; depth += 1) nested = { child: nested }
    const tooDeep = await tool.execute({ ops: [{ op: 'add', shape: nested }] }, context())
    expect(tooDeep.isError).toBe(true)
    expect(tooDeep.output).toMatchObject({ ok: false, error: expect.stringContaining('nesting depth 32') })

    const tooLarge = await tool.execute({
      ops: [{ op: 'add', shape: { type: 'text', text: 'x'.repeat(512 * 1024) } }]
    }, context())
    expect(tooLarge.isError).toBe(true)
    expect(tooLarge.output).toMatchObject({ ok: false, error: expect.stringContaining('exceed 524288 bytes') })
  })

  it('accepts a direct top-level ShapeOp when the model omits ops', async () => {
    const tool = createDesignUpdateShapesTool()
    const op = {
      op: 'update',
      id: 'shape_1',
      patch: { imageUrl: '.deepseekgui-images/img.png' }
    }
    const result = await tool.execute(op, context())

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [op]
    })
  })

  it('normalizes loose update arguments into a ShapeOp', async () => {
    const tool = createDesignUpdateShapesTool()
    const result = await tool.execute(
      {
        shape_id: 'slot_1',
        relative_path: '.deepseekgui-images/img-slot.png'
      },
      context()
    )

    expect(result.isError).toBeUndefined()
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_UPDATE_SHAPES_TOOL_NAME,
      ops: [
        {
          op: 'update',
          id: 'slot_1',
          patch: { imageUrl: '.deepseekgui-images/img-slot.png' }
        }
      ]
    })
  })

  it('queues a structured project design-system operation without board placement', async () => {
    const tool = createDesignSystemTemplateTool()
    expect(tool.name).toBe(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME)
    expect(JSON.stringify(tool.inputSchema)).toContain('Web -> saas/web components')
    expect(JSON.stringify(tool.inputSchema)).toContain('App -> mobile/app components')
    expect(tool.name).toBe('design_system')
    expect(tool.description).toContain('root DESIGN.md')
    expect(tool.description).toContain('never draws an HTML, SVG, or freeform style-kit board')
    const result = await tool.execute(
      { name: 'IKUN World', seedColor: '#D4AF37', mode: 'dark', template: 'game' },
      context()
    )
    expect(result.output).toMatchObject({
      ok: true,
      tool: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
      ops: [
        {
          op: 'design-system-template',
          operation: 'create',
          name: 'IKUN World',
          seedColor: '#D4AF37',
          mode: 'dark',
          template: 'game'
        }
      ]
    })
    expect(JSON.stringify(result.output)).not.toContain('"x"')
    expect(JSON.stringify(result.output)).not.toContain('"y"')
  })

  it('preserves target ids for design-system validation tools', async () => {
    const templateTool = createDesignSystemTemplateTool()
    const templateResult = await templateTool.execute(
      { operation: 'validate', targetIds: ['screen-1', 42, 'button-1'] },
      context()
    )
    expect(templateResult.output).toMatchObject({
      ok: true,
      tool: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
      ops: [{ op: 'lint-design-system', targetIds: ['screen-1', 'button-1'] }]
    })

    const validateTool = createDesignValidateTool()
    expect(validateTool.name).toBe(DESIGN_VALIDATE_TOOL_NAME)
    const validateResult = await validateTool.execute(
      { targetIds: ['card-1', null, 'card-label'] },
      context()
    )
    expect(validateResult.output).toMatchObject({
      ok: true,
      tool: DESIGN_VALIDATE_TOOL_NAME,
      ops: [{ op: 'lint-design-system', targetIds: ['card-1', 'card-label'] }]
    })
  })

  it('normalizes structured tokens, captured components, variants, and deletions', async () => {
    const tool = createDesignSystemTemplateTool()
    const result = await tool.execute({
      operation: 'update',
      expectedHash: 'source-123',
      tokens: [{ name: 'brand/primary', kind: 'color', value: '#2563eb' }],
      captureComponents: [{ name: 'Button', fromId: 'shape_button', slots: [{ path: 'label', kind: 'text' }] }],
      variants: [{
        component: 'Button',
        key: 'size=small',
        selection: { size: 'small' },
        overrides: { shape_button: { width: 96 } }
      }],
      deleteTokenNames: ['legacy/color'],
      deleteComponentNames: ['LegacyCard']
    }, context())

    expect(result.output).toMatchObject({
      ok: true,
      tool: 'design_system',
      operation: 'update',
      expectedHash: 'source-123',
      ops: [
        { op: 'define-token', name: 'brand/primary', kind: 'color', value: '#2563eb' },
        { op: 'define-component', name: 'Button', fromId: 'shape_button' },
        { op: 'set-component-variant', name: 'Button', key: 'size=small' },
        { op: 'delete-token', name: 'legacy/color' },
        { op: 'delete-component', name: 'LegacyCard' }
      ]
    })
    expect(JSON.stringify(result.output)).not.toContain('design-system-template')
  })
})
