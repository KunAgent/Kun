import {
  designCanvasReceiptKey,
  designToolError,
  designToolOutput,
  oneOf,
  stringArg
} from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const DESIGN_CREATE_DIAGRAM_TOOL_NAME = 'design_create_diagram'

const placementDescription =
  'Inspect the current canvas snapshot and avoid existing content. Omit coordinates when exact placement is not required.'

const dimensionDescription =
  'Optional explicit diagram frame dimension. Omit it unless the user asks for a custom size.'

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

export function createDesignCreateDiagramTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_CREATE_DIAGRAM_TOOL_NAME,
    description: [
      'Create a branded HTML-first diagram on the active Design canvas by reserving a linked screen artifact and starting the existing follow-up HTML generation turn.',
      'Use this for complex flowcharts, architecture, sequence, data-flow, ER, timeline, swimlane, and chart-like diagrams. The generated self-contained HTML with inline SVG remains the source of truth and is rendered as an HTML frame.',
      'When the user explicitly needs every node editable, use design_update_shapes instead. For a standalone vector or motion asset, use design_svg_create.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiDesignCanvas === true && context.guiDesignMode === true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Diagram title shown on the canvas.' },
        brief: { type: 'string', description: 'Diagram content, hierarchy, relationships, and required labels.' },
        diagramType: { type: 'string', description: 'Selected diagram grammar, for example flowchart, architecture, sequence, data-flow, ER, or timeline.' },
        semanticPattern: { type: 'string', description: 'Optional behavior-first semantic pattern.' },
        sizePreset: { type: 'string', enum: ['doc-inline', 'doc-wide', 'slide-16x9', 'slide-4x3', 'social-og', 'social-square', 'fit'] },
        detailLevel: { type: 'string', enum: ['faithful', 'balanced', 'simplified'] },
        audience: { type: 'string', enum: ['engineer', 'mixed', 'executive'] },
        motion: { type: 'string', enum: ['none', 'explanatory'] },
        x: { type: 'number', description: placementDescription },
        y: { type: 'number', description: placementDescription },
        width: { type: 'number', description: dimensionDescription },
        height: { type: 'number', description: dimensionDescription }
      },
      required: ['name', 'brief', 'diagramType'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const name = stringArg(args.name)
      const brief = stringArg(args.brief)
      const diagramType = stringArg(args.diagramType)
      if (!name || !brief || !diagramType) {
        return designToolError('design_create_diagram requires name, brief, and diagramType')
      }
      const diagramBrief = [
        'Create an HTML-first diagram with self-contained CSS and inline accessible SVG.',
        'Use the locked root DESIGN.md snapshot as the only theme source; do not create a separate style guide.',
        `Diagram type: ${diagramType}.`,
        stringArg(args.semanticPattern) ? `Semantic pattern: ${stringArg(args.semanticPattern)}.` : '',
        `Size preset: ${oneOf(args.sizePreset, ['doc-inline', 'doc-wide', 'slide-16x9', 'slide-4x3', 'social-og', 'social-square', 'fit']) ?? 'doc-inline'}.`,
        `Detail: ${oneOf(args.detailLevel, ['faithful', 'balanced', 'simplified']) ?? 'balanced'}.`,
        `Audience: ${oneOf(args.audience, ['engineer', 'mixed', 'executive']) ?? 'mixed'}.`,
        `Motion: ${oneOf(args.motion, ['none', 'explanatory']) ?? 'none'}.`,
        'Follow diagram-design rules: low density, one or two focal accents, orthogonal rounded connectors, readable connector labels, accessible title/description, and reduced-motion fallback.',
        brief
      ].filter(Boolean).join('\n')
      const op = {
        op: 'add-screen', name, brief: diagramBrief, devicePreset: 'desktop',
        ...(finiteNumber(args.x) !== undefined ? { x: finiteNumber(args.x) } : {}),
        ...(finiteNumber(args.y) !== undefined ? { y: finiteNumber(args.y) } : {}),
        ...(finiteNumber(args.width) !== undefined ? { width: finiteNumber(args.width) } : {}),
        ...(finiteNumber(args.height) !== undefined ? { height: finiteNumber(args.height) } : {})
      }
      return designToolOutput(DESIGN_CREATE_DIAGRAM_TOOL_NAME, 'create_diagram', [op], {
        status: 'accepted',
        diagramType,
        receiptKey: designCanvasReceiptKey(context?.threadId, context?.turnId, context?.activeToolCallId, [op])
      })
    }
  })
}
