import { executeBindCodeInvocation } from './bind-code-executor'
import { executeDesignCritiqueInvocation } from './critique-executor'
import { executeDesignExportInvocation } from './export-executor'
import { executeGenerateDirectionsInvocation } from './generate-directions-executor'
import { executeGenerateScreenInvocation } from './generate-screen-executor'
import { executeImplementInvocation } from './implement-executor'
import { executeDesignOpsInvocation } from './ops-executor'
import { executeDesignPlanInvocation } from './plan-executor'
import { executeRepairInvocation } from './repair-executor'
import { executeDesignSystemInvocation } from './system-executor'
import { executeDesignMotionInvocation } from './motion-executor'
import type { DesignToolInvocation, DesignToolInvocationResult } from './protocol-types'
export type { DesignToolInvocation, DesignToolInvocationResult } from './protocol-types'

export type DesignToolProtocolCategory =
  | 'planning'
  | 'generation'
  | 'operations'
  | 'review'
  | 'system'
  | 'code'
  | 'export'

export type DesignToolProtocolTool = {
  id: string
  category: DesignToolProtocolCategory
  purpose: string
  inputs: string[]
  outputs: string[]
  operationTypes?: string[]
  requiresSelection?: boolean
  requiresCodeBinding?: boolean
}

export type DesignToolProtocolManifest = {
  version: 1
  kind: 'kun.design.tool-protocol'
  source: 'kun-design-mode'
  tools: DesignToolProtocolTool[]
}

export const DESIGN_TOOL_PROTOCOL_RESOURCE_ID = 'design-tool-protocol'

export const DESIGN_TOOL_PROTOCOL_TOOLS: DesignToolProtocolTool[] = [
  {
    id: 'design.plan',
    category: 'planning',
    purpose: 'Produce the work plan, direction strategy, constraints, and next operation sequence.',
    inputs: ['user request', 'Design Graph', 'DESIGN.md', 'selected objects', 'direction scorecards'],
    outputs: ['plan summary', 'direction strategy', 'tool sequence']
  },
  {
    id: 'design.ops',
    category: 'operations',
    purpose: 'Apply validated Design Operations against the canvas source of truth.',
    inputs: ['DesignOperation[]', 'target object ids'],
    outputs: ['operation journal entry', 'affected ids', 'schema errors'],
    operationTypes: [
      'create_frame',
      'create_shape',
      'update_shape',
      'move_shape',
      'resize_shape',
      'apply_token',
      'define_component',
      'link_prototype'
    ]
  },
  {
    id: 'design_motion_set_timeline',
    category: 'operations',
    purpose: 'Configure the canonical frame/layer Motion timeline duration and playback mode.',
    inputs: ['stable frame id', 'durationMs', 'once/loop/ping-pong playback'],
    outputs: ['editable CanvasDocument.motion timeline', 'operation journal entry', 'affected ids'],
    operationTypes: ['set-timeline']
  },
  {
    id: 'design_motion_upsert_keyframes',
    category: 'operations',
    purpose: 'Create or update typed layer property tracks and stable keyframes in Design Motion.',
    inputs: ['stable frame/shape ids', 'x/y/rotation/scale/opacity property', 'typed keyframes and easing'],
    outputs: ['editable canonical track', 'operation journal entry', 'bounded validation errors'],
    operationTypes: ['upsert-keyframes']
  },
  {
    id: 'design_motion_apply_preset',
    category: 'operations',
    purpose: 'Compile Fade, Move, Scale, or Rotate into ordinary editable Motion tracks.',
    inputs: ['stable frame/shape ids', 'preset timing', 'stagger and easing'],
    outputs: ['editable canonical tracks', 'operation journal entry', 'affected ids'],
    operationTypes: ['apply-preset']
  },
  {
    id: 'design_motion_delete',
    category: 'operations',
    purpose: 'Idempotently remove a canonical Motion timeline, property track, or keyframe.',
    inputs: ['stable frame, track, target, or keyframe ids from the motion snapshot'],
    outputs: ['updated canonical Motion document', 'operation journal entry'],
    operationTypes: ['delete']
  },
  {
    id: 'design.generate_screen',
    category: 'generation',
    purpose: 'Create or iterate one screen from prompt, image, references, and existing design context.',
    inputs: ['prompt', 'design target', 'tokens', 'components', 'nearby canvas context'],
    outputs: ['HtmlFrame', 'screen DESIGN.md', 'operation journal entry']
  },
  {
    id: 'design.generate_directions',
    category: 'generation',
    purpose: 'Create multiple named UI directions for the same product goal.',
    inputs: ['prompt', 'direction count', 'design target', 'reference assets'],
    outputs: ['direction frames', 'rationale', 'direction scorecards']
  },
  {
    id: 'design_svg_create',
    category: 'generation',
    purpose: 'Reserve a standalone SVG artifact and place its first-class frame on the active whiteboard.',
    inputs: ['name', 'brief', 'frame geometry'],
    outputs: ['deterministic artifact id', 'SVG artifact', 'SVG frame', 'reserved v1.svg']
  },
  {
    id: 'design_svg_inspect',
    category: 'operations',
    purpose: 'Inspect SVG structure, editable ids, definitions, and declarative animation without inlining raw XML.',
    inputs: ['active SVG artifact context'],
    outputs: ['element inventory', 'animation inventory', 'SVG diagnostics']
  },
  {
    id: 'design_svg_edit',
    category: 'operations',
    purpose: 'Apply structured vector element, definition, hierarchy, and document edits to the active SVG version.',
    inputs: ['active SVG artifact context', 'structured SVG edit operations'],
    outputs: ['updated SVG file', 'affected element ids']
  },
  {
    id: 'design_svg_animate',
    category: 'operations',
    purpose: 'Add or update declarative attribute, transform, motion-path, and path-draw animation.',
    inputs: ['active SVG artifact context', 'target element id', 'animation timing and values'],
    outputs: ['updated SVG file', 'animation id']
  },
  {
    id: 'design_svg_validate',
    category: 'review',
    purpose: 'Validate SVG safety, references, accessibility, stable ids, and declarative animation readiness.',
    inputs: ['active SVG artifact context'],
    outputs: ['validation status', 'errors', 'warnings']
  },
  {
    id: 'design.critique',
    category: 'review',
    purpose: 'Evaluate selected frames or flows for layout, hierarchy, tokens, accessibility, and code readiness.',
    inputs: ['selected object ids', 'Design Graph', 'quality checks'],
    outputs: ['agentNote findings', 'validation journal entry'],
    requiresSelection: true
  },
  {
    id: 'design.repair',
    category: 'review',
    purpose: 'Repair critique findings through focused design operations.',
    inputs: ['agentNote findings', 'operation journal', 'selected objects'],
    outputs: ['DesignOperation[]', 'resolved findings']
  },
  {
    id: 'design.system',
    category: 'system',
    purpose: 'Define, update, validate, or apply tokens, components, variants, and states.',
    inputs: ['selected objects', 'DesignSystem graph summary', 'style samples'],
    outputs: ['tokens', 'components', 'variant matrix', 'lint findings'],
    operationTypes: ['define_token', 'apply_token', 'define_component', 'instantiate_component', 'lint_design']
  },
  {
    id: 'design.bind_code',
    category: 'code',
    purpose: 'Create or refresh code bindings from running app frames, DOM/source ids, routes, and components.',
    inputs: ['running app frames', 'DOM source snapshot', 'existing bindings'],
    outputs: ['CodeBinding[]', 'stale/missing binding report'],
    requiresCodeBinding: false
  },
  {
    id: 'design.implement',
    category: 'code',
    purpose: 'Apply bound design changes to source code through grouped code transforms.',
    inputs: ['operation journal', 'active CodeBinding[]', 'workspace adapter'],
    outputs: ['code change requests', 'written files', 'skipped requests'],
    requiresCodeBinding: true
  },
  {
    id: 'design.export',
    category: 'export',
    purpose: 'Export DESIGN.md, Penpot handoff, MCP resources, image/prototype, or code handoff payloads.',
    inputs: ['DesignDocument', 'Design Graph', 'DesignSystem', 'artifacts'],
    outputs: ['DESIGN.md', 'resource surface', 'handoff packages']
  }
]

export function buildDesignToolProtocolManifest(): DesignToolProtocolManifest {
  return {
    version: 1,
    kind: 'kun.design.tool-protocol',
    source: 'kun-design-mode',
    tools: DESIGN_TOOL_PROTOCOL_TOOLS
  }
}

export function designToolProtocolSummaryLines(
  tools: readonly DesignToolProtocolTool[] = DESIGN_TOOL_PROTOCOL_TOOLS
): string[] {
  return tools.map((tool) => {
    const flags = [
      tool.requiresSelection ? 'selection required' : '',
      tool.requiresCodeBinding ? 'code binding required' : ''
    ].filter(Boolean)
    const suffix = flags.length > 0 ? `; ${flags.join('; ')}` : ''
    return `- ${tool.id} (${tool.category}): ${tool.purpose}${suffix}`
  })
}

export function designToolProtocolById(
  id: string,
  tools: readonly DesignToolProtocolTool[] = DESIGN_TOOL_PROTOCOL_TOOLS
): DesignToolProtocolTool | undefined {
  return tools.find((tool) => tool.id === id)
}

function unsupportedToolResult(invocation: DesignToolInvocation): DesignToolInvocationResult {
  const tool = designToolProtocolById(invocation.toolId)
  return {
    ok: false,
    toolId: invocation.toolId,
    status: 'unsupported',
    affectedIds: [],
    errors: [{
      code: 'UNSUPPORTED_TOOL',
      message: tool
        ? `${invocation.toolId} is declared but does not have a local executor yet.`
        : `Unknown design tool: ${invocation.toolId}`
    }],
    summaryLines: [
      tool
        ? `${invocation.toolId}: executor pending`
        : `${invocation.toolId}: unknown design tool`
    ]
  }
}

export function executeDesignToolInvocation(
  invocation: DesignToolInvocation
): DesignToolInvocationResult {
  if (invocation.toolId === 'design.plan') return executeDesignPlanInvocation(invocation)
  if (invocation.toolId === 'design.ops') return executeDesignOpsInvocation(invocation)
  if (invocation.toolId.startsWith('design_motion_')) return executeDesignMotionInvocation(invocation)
  if (invocation.toolId === 'design.generate_screen') return executeGenerateScreenInvocation(invocation)
  if (invocation.toolId === 'design.generate_directions') return executeGenerateDirectionsInvocation(invocation)
  if (invocation.toolId === 'design.critique') return executeDesignCritiqueInvocation(invocation)
  if (invocation.toolId === 'design.repair') return executeRepairInvocation(invocation)
  if (invocation.toolId === 'design.system') return executeDesignSystemInvocation(invocation)
  if (invocation.toolId === 'design.bind_code') return executeBindCodeInvocation(invocation)
  if (invocation.toolId === 'design.implement') return executeImplementInvocation(invocation)
  if (invocation.toolId === 'design.export') return executeDesignExportInvocation(invocation)
  return unsupportedToolResult(invocation)
}
