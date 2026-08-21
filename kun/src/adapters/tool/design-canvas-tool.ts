import { createHash } from 'node:crypto'
import { KUN_GENERATED_IMAGE_DIR } from '../../contracts/generated-image-path.js'
import {
  DESIGN_UPDATE_SHAPES_MAX_OPS,
  designCanvasReceiptKey,
  designShapeMutationBudgetError,
  designToolError,
  designToolOutput,
  normalizeArrangeOp,
  normalizeDesignCanvasArgs,
  normalizeDesignUpdateShapeOps,
  normalizeScreenSpecs,
  normalizeStructuredDesignSystemOps,
  numberArg,
  oneOf,
  safeCanvasExportStem,
  stringArg
} from './design-canvas-normalization.js'
import {
  DESIGN_SHAPE_OP_INPUT_SCHEMA,
  DESIGN_SHAPE_OP_TOOL_CONTRACT
} from './design-shape-op-tool-contract.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export { DESIGN_UPDATE_SHAPES_MAX_OPS } from './design-canvas-normalization.js'

export const DESIGN_CANVAS_TOOL_NAME = 'design_canvas'
export const DESIGN_CREATE_SCREEN_TOOL_NAME = 'design_create_screen'
export const DESIGN_UPDATE_SHAPES_TOOL_NAME = 'design_update_shapes'
export const DESIGN_ARRANGE_TOOL_NAME = 'design_arrange'
export const DESIGN_EXPORT_CANVAS_TOOL_NAME = 'design_export_canvas'
export const DESIGN_SYSTEM_TOOL_NAME = 'design_system'
/** @deprecated Source-compatible alias; the advertised tool is now `design_system`. */
export const DESIGN_SYSTEM_TEMPLATE_TOOL_NAME = DESIGN_SYSTEM_TOOL_NAME
export const DESIGN_VALIDATE_TOOL_NAME = 'design_validate'
export const DESIGN_SVG_CREATE_TOOL_NAME = 'design_svg_create'
export const WORK_RENAME_WHITEBOARD_TOOL_NAME = 'work_rename_whiteboard'

export const DESIGN_CANVAS_MUTATION_TOOL_NAMES = [
  DESIGN_CANVAS_TOOL_NAME,
  DESIGN_CREATE_SCREEN_TOOL_NAME,
  DESIGN_UPDATE_SHAPES_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_EXPORT_CANVAS_TOOL_NAME,
  DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
  DESIGN_VALIDATE_TOOL_NAME,
  DESIGN_SVG_CREATE_TOOL_NAME,
  WORK_RENAME_WHITEBOARD_TOOL_NAME
] as const


const SHOULD_ADVERTISE_DESIGN_TOOL = (context: { guiDesignCanvas?: boolean }) =>
  context.guiDesignCanvas === true


const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const DEVICE_PRESET_DESCRIPTION =
  'Optional explicit screen preset. Omit it unless the user asks for a different device; the renderer follows the current Design target (Web -> desktop 1280x800, App -> mobile 390x844).'

const SCREEN_DIMENSION_DESCRIPTION =
  'Optional explicit screen dimension. Omit it unless the user asks for a custom size; omitted dimensions follow the current Design target together with devicePreset.'

const DESIGN_TEMPLATE_DESCRIPTION =
  'Optional template family. Omit it to follow the current Design target (Web -> saas/web components, App -> mobile/app components).'

const CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION =
  'Before setting x/y, inspect the current canvas snapshot in the turn prompt and avoid existing shapes, images, frames, selected bounds, occupied frames, and content bounds. Omit x/y when no exact placement is required so the renderer can choose a non-overlapping slot.'

export function buildDesignCanvasLocalTools(): LocalTool[] {
  return [
    createDesignCanvasTool(),
    createDesignCreateScreenTool(),
    createDesignUpdateShapesTool(),
    createDesignArrangeTool(),
    createDesignExportCanvasTool(),
    createDesignSystemTemplateTool(),
    createDesignValidateTool(),
    createDesignSvgCreateTool(),
    createWorkRenameWhiteboardTool()
  ]
}

export function createWorkRenameWhiteboardTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: WORK_RENAME_WHITEBOARD_TOOL_NAME,
    description: [
      'Rename the active Work whiteboard and its bound Work conversation.',
      'Use this when the user asks to rename, retitle, or change the name of the current Work whiteboard; do not use shape text operations for the board title.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) =>
      context.guiDesignCanvas === true && context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 160,
          description: 'The complete new title for the active Work whiteboard.'
        }
      },
      required: ['title'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const title = stringArg(args.title)?.slice(0, 160)
      if (!title) return designToolError('work_rename_whiteboard requires a non-empty title')
      const receiptSeed = [{ op: 'rename-work-whiteboard', title }]
      return designToolOutput(WORK_RENAME_WHITEBOARD_TOOL_NAME, 'rename_whiteboard', [], {
        title,
        status: 'accepted',
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          receiptSeed
        )
      })
    }
  })
}

export function createDesignSvgCreateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SVG_CREATE_TOOL_NAME,
    description: [
      'Create a first-class standalone SVG or SVG-motion artifact on the Design whiteboard.',
      'Use this for vector logos, icons, loaders, illustrations, path animation, and reusable animated assets; do not use it for HTML product screens or raster imagery.',
      'After this call the renderer reserves and selects the SVG artifact, then starts a dedicated SVG turn with structured edit and animation tools.'
    ].join(' '),
    // The renderer reserves an SVG file when it applies this result. Model the
    // operation as a file mutation so read-only/external sandboxes cannot expose
    // a tool whose GUI-side continuation would violate the turn policy.
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiDesignCanvas === true && context.guiDesignMode === true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        brief: { type: 'string' },
        x: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        y: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        width: { type: 'number', minimum: 64, maximum: 4096, description: 'SVG viewBox and whiteboard frame width. Defaults to 640.' },
        height: { type: 'number', minimum: 64, maximum: 4096, description: 'SVG viewBox and whiteboard frame height. Defaults to 480.' }
      },
      required: ['name', 'brief'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const name = stringArg(args.name)
      const brief = stringArg(args.brief)
      if (!name || !brief) return designToolError('design_svg_create requires name and brief')
      const width = finiteNumber(args.width)
      const height = finiteNumber(args.height)
      if (width !== undefined && (width < 64 || width > 4096)) {
        return designToolError('design_svg_create width must be between 64 and 4096')
      }
      if (height !== undefined && (height < 64 || height > 4096)) {
        return designToolError('design_svg_create height must be between 64 and 4096')
      }
      // Stable across SSE replay, renderer remounts, and app restarts. The
      // renderer uses this id as the durable exactly-once key for artifact
      // reservation instead of inventing a new random directory on each replay.
      const artifactId = `svg-${createHash('sha256')
        .update(`${context.threadId}\0${context.turnId}\0${name}\0${brief}`)
        .digest('hex')
        .slice(0, 12)}`
      return designToolOutput(DESIGN_SVG_CREATE_TOOL_NAME, 'create_svg', [{
        op: 'add-svg-artifact',
        artifactId,
        name,
        brief,
        ...(finiteNumber(args.x) !== undefined ? { x: finiteNumber(args.x) } : {}),
        ...(finiteNumber(args.y) !== undefined ? { y: finiteNumber(args.y) } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {})
      }])
    }
  })
}

export function createDesignCanvasTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_CANVAS_TOOL_NAME,
    description: [
      'Create or update the active GUI canvas: Design mode canvas or Code-mode sidebar whiteboard. Use this only when Kun is in a canvas turn.',
      'The renderer applies the returned operations to the active canvas; do not emit markdown code blocks for canvas operations.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create_board', 'add_screen', 'update_shapes'],
          description:
            'create_board is optional/no-op; add_screen creates a screen/frame operation (Design mode may generate linked HTML, Code whiteboard creates an editable frame); update_shapes applies vector/image shape ops.'
        },
        title: {
          type: 'string',
          description: 'Optional board title for create_board.'
        },
        name: {
          type: 'string',
          description: 'Screen/frame name for add_screen.'
        },
        brief: {
          type: 'string',
          description: 'Self-contained screen/frame brief for add_screen. Design mode uses it for follow-up HTML generation; Code whiteboard keeps the result as editable canvas shapes.'
        },
        x: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        y: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        width: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
        height: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
        devicePreset: {
          type: 'string',
          enum: ['mobile', 'tablet', 'desktop'],
          description: DEVICE_PRESET_DESCRIPTION
        },
        ops: {
          description: `For update_shapes: a ShapeOp object or array of at most 100 ShapeOps. Prefer batches of 20-50 related operations and continue larger work in subsequent calls. ${DESIGN_SHAPE_OP_TOOL_CONTRACT}`,
          anyOf: [
            DESIGN_SHAPE_OP_INPUT_SCHEMA,
            { type: 'array', maxItems: DESIGN_UPDATE_SHAPES_MAX_OPS, items: DESIGN_SHAPE_OP_INPUT_SCHEMA }
          ]
        }
      },
      required: ['action'],
      additionalProperties: true
    },
    execute: async (args, context) => {
      const normalized = normalizeDesignCanvasArgs(args)
      if (!normalized.ok) {
        return {
          output: {
            ok: false,
            error: normalized.error
          },
          isError: true
        }
      }
      if (normalized.action === 'update_shapes') {
        const budgetError = designShapeMutationBudgetError(args, normalized.ops)
        if (budgetError) return designToolError(budgetError)
      }
      // Renderer-executed mutations return an `accepted` placeholder with a
      // receipt key instead of claiming verified success. `create_board` is
      // renderer-free and stays synchronous.
      if (normalized.ops.length === 0) {
        return {
          output: {
            ok: true,
            action: normalized.action,
            ops: normalized.ops,
            message: normalized.message
          }
        }
      }
      return designToolOutput(DESIGN_CANVAS_TOOL_NAME, normalized.action, normalized.ops, {
        status: 'accepted',
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          normalized.ops
        )
      })
    }
  })
}

export function createDesignCreateScreenTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_CREATE_SCREEN_TOOL_NAME,
    description: [
      'Create one or more GUI canvas screen/frame shapes. Prefer this over design_canvas action=add_screen.',
      'The renderer places omitted coordinates in the current whiteboard viewport while avoiding existing screen/content, and follows the current Design target when devicePreset is omitted. If you set coordinates, derive them from the current canvas snapshot so new frames do not cover existing images or frames. Design mode generates screen HTML afterwards; Code-mode whiteboard creates plain editable frame shapes with no HTML generation.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Screen/frame name for a single screen or whiteboard frame.' },
        brief: {
          type: 'string',
          description:
            'Self-contained screen/frame brief. Design mode uses it for follow-up HTML generation; Code-mode whiteboard keeps it as frame context only.'
        },
        x: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        y: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
        width: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
        height: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
        devicePreset: {
          type: 'string',
          enum: ['mobile', 'tablet', 'desktop'],
          description: DEVICE_PRESET_DESCRIPTION
        },
        screens: {
          type: 'array',
          maxItems: 20,
          description: 'Optional batch of screen specs. When present, name/brief/x/y/width/height are ignored.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              brief: { type: 'string' },
              x: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
              y: { type: 'number', description: CANVAS_SNAPSHOT_PLACEMENT_DESCRIPTION },
              width: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
              height: { type: 'number', description: SCREEN_DIMENSION_DESCRIPTION },
              devicePreset: {
                type: 'string',
                enum: ['mobile', 'tablet', 'desktop'],
                description: DEVICE_PRESET_DESCRIPTION
              }
            },
            required: ['name'],
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      const screens = normalizeScreenSpecs(args)
      if (!screens.ok) return designToolError(screens.error)
      const ops = screens.specs.length === 1
        ? [{ op: 'add-screen', ...screens.specs[0] }]
        : [{ op: 'add-screens', specs: screens.specs }]
      return designToolOutput(DESIGN_CREATE_SCREEN_TOOL_NAME, 'create_screen', ops, {
        status: 'accepted',
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          ops
        )
      })
    }
  })
}

export function createDesignUpdateShapesTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_UPDATE_SHAPES_TOOL_NAME,
    description: [
      'Apply validated shape operations to the active design canvas: add, update, delete, move, resize, style, token, component, and image changes.',
      'Use this for whiteboard/vector edits. Prefer batches of 20-50 related operations and continue larger work in subsequent calls; one call accepts at most 100 operations.',
      'Use design_create_screen for new screen frames and design_system for the project design-system file. For any add/move/resize coordinates, inspect the current canvas snapshot first and preserve existing object bounds unless the user asked to replace them.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        ops: {
          description: `Preferred: a ShapeOp object or array of ShapeOps. The renderer validates and applies each op atomically. If omitted, a direct top-level ShapeOp is also accepted. ${DESIGN_SHAPE_OP_TOOL_CONTRACT}`,
          anyOf: [
            DESIGN_SHAPE_OP_INPUT_SCHEMA,
            {
              type: 'array',
              maxItems: DESIGN_UPDATE_SHAPES_MAX_OPS,
              items: DESIGN_SHAPE_OP_INPUT_SCHEMA
            }
          ]
        },
        op: {
          type: 'string',
          enum: [...DESIGN_SHAPE_OP_INPUT_SCHEMA.properties.op.enum],
          description: 'Direct ShapeOp fallback. Prefer wrapping it in ops.'
        }
      },
      additionalProperties: true
    },
    execute: async (args, context) => {
      const ops = normalizeDesignUpdateShapeOps(args)
      if (!ops) return designToolError('design_update_shapes requires ops as an object or array')
      const budgetError = designShapeMutationBudgetError(args, ops)
      if (budgetError) return designToolError(budgetError)
      return designToolOutput(DESIGN_UPDATE_SHAPES_TOOL_NAME, 'update_shapes', ops, {
        status: 'accepted',
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          ops
        )
      })
    }
  })
}

export function createDesignExportCanvasTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_EXPORT_CANVAS_TOOL_NAME,
    description: [
      'Export the current Code sidebar whiteboard as a real PNG or SVG workspace file that the GUI can show in the conversation.',
      'Use this only when the user explicitly asks for an image, PNG, SVG, export, or file copy of the whiteboard.',
      'If the requested diagram is already present in the current canvas snapshot, call this tool directly without redrawing it. Otherwise create or update the editable diagram with design_update_shapes first, then call this tool. Do not replace an editable architecture diagram with generate_image.'
    ].join(' '),
    // The tool result is a durable renderer request. The renderer performs the
    // actual file write after the latest shape operations have painted.
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiDesignCanvas === true && context.guiDesignMode !== true,
    inputSchema: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['png', 'svg'],
          description: 'Export format. Omit it when the user asks for an image; PNG is the default.'
        },
        name: {
          type: 'string',
          maxLength: 80,
          description: 'Optional short filename stem. The renderer adds a stable suffix and the selected extension.'
        }
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      const rawName = stringArg(args.name)
      const nameFormat = oneOf(rawName?.match(/\.(png|svg)$/i)?.[1]?.toLowerCase(), ['png', 'svg'])
      const format = oneOf(args.format, ['png', 'svg']) ?? nameFormat ?? 'png'
      const requestedName = rawName?.replace(/\.(?:png|svg)$/i, '')
      const stem = safeCanvasExportStem(requestedName || 'kun-whiteboard')
      const suffix = createHash('sha256')
        .update(`${context.threadId}\0${context.turnId}\0${stem}\0${format}`)
        .digest('hex')
        .slice(0, 12)
      const fileName = `${stem}-${suffix}.${format}`
      const relativePath = `${KUN_GENERATED_IMAGE_DIR}/${fileName}`
      const exportRequest = { format, fileName, relativePath }

      return {
        output: {
          ok: true,
          tool: DESIGN_EXPORT_CANVAS_TOOL_NAME,
          action: 'export_canvas',
          exportRequest,
          status: 'accepted',
          receiptKey: designCanvasReceiptKey(
            context.threadId,
            context.turnId,
            context.activeToolCallId,
            [exportRequest]
          ),
          ops: [],
          message: `Accepted the current whiteboard for ${format.toUpperCase()} export at ${relativePath}; this result does not verify that the renderer wrote the file.`
        }
      }
    }
  })
}

export function createDesignArrangeTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_ARRANGE_TOOL_NAME,
    description: [
      'Arrange existing canvas objects with alignment, distribution, stacking, grid layout, or responsive reflow.',
      'This keeps whiteboard layout operations explicit and avoids mixing arrangement intent with low-level shape edits. Operate only on ids from the current canvas snapshot and do not arrange new content over unrelated existing objects.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['align', 'distribute', 'stack', 'grid', 'responsive_reflow']
        },
        ids: { type: 'array', items: { type: 'string' } },
        id: { type: 'string' },
        frameId: { type: 'string' },
        axis: {
          type: 'string',
          enum: ['left', 'h-center', 'right', 'top', 'v-center', 'bottom', 'horizontal', 'vertical']
        },
        direction: { type: 'string', enum: ['horizontal', 'vertical'] },
        cols: { type: 'number' },
        gap: { type: 'number' },
        rowGap: { type: 'number' },
        colGap: { type: 'number' },
        name: { type: 'string' },
        asFrame: { type: 'boolean' },
        device: { type: 'string', enum: ['mobile', 'tablet', 'desktop'] }
      },
      required: ['operation'],
      additionalProperties: false
    },
    execute: async (args) => {
      const normalized = normalizeArrangeOp(args)
      if (!normalized.ok) return designToolError(normalized.error)
      return designToolOutput(DESIGN_ARRANGE_TOOL_NAME, 'arrange', [normalized.op])
    }
  })
}

export function createDesignSystemTemplateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_SYSTEM_TEMPLATE_TOOL_NAME,
    description: [
      'Create, structurally update, apply, or validate the Google-compatible project design system at root DESIGN.md with expected-hash conflict protection.',
      'The Design canvas reads and renders that file with its fixed built-in specimen board. It preserves Markdown prose and unknown extensions and never draws an HTML, SVG, or freeform style-kit board.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create', 'update', 'apply', 'validate'] },
        expectedHash: { type: 'string', description: 'Last observed exact DESIGN.md source hash. Required for conflict-safe updates when known.' },
        name: { type: 'string' },
        seedColor: { type: 'string', description: 'Primary brand color as #RRGGBB. Defaults to a calibrated blue.' },
        mode: { type: 'string', enum: ['light', 'dark', 'both'] },
        template: {
          type: 'string',
          enum: ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio'],
          description: DESIGN_TEMPLATE_DESCRIPTION
        },
        tone: { type: 'string', enum: ['clean', 'playful', 'premium', 'technical', 'editorial'] },
        sections: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['palette', 'typography', 'buttons', 'forms', 'navigation', 'cards', 'icons', 'states', 'spacing', 'radius', 'shadow']
          }
        },
        targetIds: { type: 'array', items: { type: 'string' } },
        tokens: {
          type: 'array',
          description: 'Exact project tokens to upsert.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              kind: { type: 'string', enum: ['color', 'gradient', 'type', 'space', 'radius', 'shadow'] },
              value: {}
            },
            required: ['name', 'kind', 'value'],
            additionalProperties: false
          }
        },
        captureComponents: {
          type: 'array',
          description: 'Capture existing canvas subtrees as project component definitions.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              fromId: { type: 'string' },
              slots: { type: 'array', items: { type: 'object', additionalProperties: true } }
            },
            required: ['name', 'fromId'],
            additionalProperties: false
          }
        },
        variants: {
          type: 'array',
          description: 'Variant property overrides keyed by stable component-layer ids.',
          items: {
            type: 'object',
            properties: {
              component: { type: 'string' },
              key: { type: 'string' },
              selection: { type: 'object', additionalProperties: { type: 'string' } },
              overrides: { type: 'object', additionalProperties: { type: 'object', additionalProperties: true } }
            },
            required: ['component', 'key', 'selection', 'overrides'],
            additionalProperties: false
          }
        },
        deleteTokenNames: { type: 'array', items: { type: 'string' } },
        deleteComponentNames: { type: 'array', items: { type: 'string' } },
        x: { type: 'number', description: 'Deprecated and ignored; the built-in board owns its placement.' },
        y: { type: 'number', description: 'Deprecated and ignored; the built-in board owns its placement.' },
        width: { type: 'number' },
        height: { type: 'number' },
        dryRun: { type: 'boolean' }
      },
      additionalProperties: false
    },
    execute: async (args) => {
      const operation = oneOf(args.operation, ['create', 'update', 'apply', 'validate']) ?? 'create'
      if (operation === 'validate') {
        return designToolOutput(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME, 'validate_design_system', [
          {
            op: 'lint-design-system',
            ...(Array.isArray(args.targetIds) ? { targetIds: args.targetIds.filter((v): v is string => typeof v === 'string') } : {})
          }
        ], { operation: 'validate' })
      }
      const structuredOps = normalizeStructuredDesignSystemOps(args)
      const hasFoundationInput = Boolean(
        stringArg(args.name) || stringArg(args.seedColor) || args.mode || args.template || args.tone
      )
      const ops: Record<string, unknown>[] = []
      if (hasFoundationInput || structuredOps.length === 0) {
        ops.push({
          op: 'design-system-template',
          operation,
          ...(stringArg(args.expectedHash) ? { expectedHash: stringArg(args.expectedHash) } : {}),
          ...(stringArg(args.name) ? { name: stringArg(args.name) } : {}),
          ...(stringArg(args.seedColor) ? { seedColor: stringArg(args.seedColor) } : {}),
          ...(oneOf(args.mode, ['light', 'dark', 'both']) ? { mode: oneOf(args.mode, ['light', 'dark', 'both']) } : {}),
          ...(oneOf(args.template, ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio'])
            ? { template: oneOf(args.template, ['app', 'saas', 'game', 'editor', 'mobile', 'portfolio']) }
            : {}),
          ...(oneOf(args.tone, ['clean', 'playful', 'premium', 'technical', 'editorial'])
            ? { tone: oneOf(args.tone, ['clean', 'playful', 'premium', 'technical', 'editorial']) }
            : {}),
          ...(Array.isArray(args.sections) ? { sections: args.sections.filter((v): v is string => typeof v === 'string') } : {}),
          ...(Array.isArray(args.targetIds) ? { targetIds: args.targetIds.filter((v): v is string => typeof v === 'string') } : {}),
          ...(args.dryRun === true ? { dryRun: true } : {})
        })
      }
      ops.push(...structuredOps)
      return designToolOutput(DESIGN_SYSTEM_TEMPLATE_TOOL_NAME, 'design_system', ops, {
        operation,
        ...(stringArg(args.expectedHash) ? { expectedHash: stringArg(args.expectedHash) } : {})
      })
    }
  })
}

export function createDesignValidateTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_VALIDATE_TOOL_NAME,
    description:
      'Run design-system validation on the current canvas. Findings are surfaced to the next design turn for repair.',
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: SHOULD_ADVERTISE_DESIGN_TOOL,
    inputSchema: {
      type: 'object',
      properties: {
        targetIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional canvas shape ids to validate, including descendants. Omit to validate the whole design board.'
        }
      },
      additionalProperties: false
    },
    execute: async (args) =>
      designToolOutput(DESIGN_VALIDATE_TOOL_NAME, 'validate_design_system', [
        {
          op: 'lint-design-system',
          ...(Array.isArray(args.targetIds) ? { targetIds: args.targetIds.filter((v): v is string => typeof v === 'string') } : {})
        }
      ])
  })
}
