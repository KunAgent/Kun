import { createHash } from 'node:crypto'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { designToolError, oneOf, stringArg } from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const DESIGN_OPEN_TOOL_NAME = 'design_open'
export const DESIGN_OPEN_REQUEST_VERSION = 1
export const DESIGN_OPEN_TITLE_MAX_CHARS = 120
export const DESIGN_OPEN_BRIEF_MAX_CHARS = 6_000

export type DesignOpenRequestPayload = {
  version: typeof DESIGN_OPEN_REQUEST_VERSION
  requestId: string
  status: 'queued'
  title: string
  brief: string
  target?: 'web' | 'app'
  medium?: 'html' | 'image'
}

/**
 * The Code agent's entry into Design. Canvas mutation tools stay gated to
 * Design turns (they need the renderer-built canvas snapshot and the locked
 * document target), so this tool only records a brief. The desktop workbench
 * opens the canvas and runs the Design pass on the same conversation after
 * the current reply finishes.
 *
 * GUI agent turns advertise the union of a stable Code-canvas context and a
 * Design-mode context (see modelToolDiscoveryContexts), so the canvas flags
 * are allowed here; execution re-checks the real turn and rejects Design turns.
 */
export function shouldAdvertiseDesignOpen(context: ToolHostContext): boolean {
  return context.clientSurface === 'gui' &&
    context.agentSurface === 'code' &&
    context.threadMode !== 'plan' &&
    context.guiDesignMode !== true &&
    context.imContext !== true &&
    context.roomAgent !== true &&
    context.roomPeer !== true &&
    context.roomStepKind === undefined &&
    context.executionUnitKind === undefined &&
    isNativeKunHarness(context.harnessId) &&
    Boolean(context.workspace.trim())
}

function isNativeKunHarness(harnessId: string | undefined): boolean {
  const normalized = harnessId?.trim()
  return !normalized || normalized === 'kun'
}

export function designOpenRequestId(
  context: Pick<ToolHostContext, 'threadId' | 'turnId' | 'activeToolCallId'>,
  title: string,
  brief: string
): string {
  return `design_${createHash('sha256')
    .update([context.threadId, context.turnId, context.activeToolCallId ?? '', title, brief].join('\0'))
    .digest('hex')
    .slice(0, 16)}`
}

export function createDesignOpenTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_OPEN_TOOL_NAME,
    description: [
      'Open the visual Design canvas beside this conversation and queue a design pass for a UI, screen, page, flow, or visual direction.',
      'Use it when the user asks to design, mock up, prototype, redesign, or visually compare UI options, or wants to see a design before code is written.',
      'Do not use it for code-only changes, bug fixes, diagrams of existing code, or a single inline component (use design_component for that).',
      'The design pass starts automatically after this reply ends, in this same conversation, with the full design toolset; when the conversation already has a design canvas the pass iterates on it.',
      'Gather the code context the designer needs first (current UI, components, tokens, constraints) and put it in `brief`.',
      'After calling it, end the reply with one short sentence. Do not implement the design in code until the user approves it.',
      'It only works in Code turns; inside a Design pass, draw on the canvas directly.'
    ].join(' '),
    // The design pass writes `.kun-design` files. Model the request as a file
    // mutation so read-only sandboxes never advertise a pass that cannot run.
    toolKind: 'file_change',
    policy: 'auto',
    shouldAdvertise: shouldAdvertiseDesignOpen,
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          minLength: 1,
          maxLength: DESIGN_OPEN_TITLE_MAX_CHARS,
          description: 'Short design name shown on the conversation card and the canvas, in the user\'s language.'
        },
        brief: {
          type: 'string',
          minLength: 1,
          maxLength: DESIGN_OPEN_BRIEF_MAX_CHARS,
          description: 'Self-contained design brief: what to design, which screens and states, the user\'s goals, and the relevant constraints found in the codebase.'
        },
        target: {
          type: 'string',
          enum: ['web', 'app'],
          description: 'Optional platform. web = desktop/web layout, app = mobile layout. Omit to keep the conversation default.'
        },
        medium: {
          type: 'string',
          enum: ['html', 'image'],
          description: 'Optional output. html = interactive screens (default); image = generated visual concepts.'
        }
      },
      required: ['title', 'brief'],
      additionalProperties: false
    },
    execute: async (args, context) => {
      const title = stringArg(args.title)?.slice(0, DESIGN_OPEN_TITLE_MAX_CHARS)
      const brief = stringArg(args.brief)?.slice(0, DESIGN_OPEN_BRIEF_MAX_CHARS)
      if (!title || !brief) return designToolError('design_open requires a non-empty title and brief')
      const target = oneOf(args.target, ['web', 'app'] as const)
      const medium = oneOf(args.medium, ['html', 'image'] as const)
      const designRequest: DesignOpenRequestPayload = {
        version: DESIGN_OPEN_REQUEST_VERSION,
        requestId: designOpenRequestId(context, title, brief),
        status: 'queued',
        title,
        brief,
        ...(target ? { target } : {}),
        ...(medium ? { medium } : {})
      }
      return {
        output: {
          ok: true,
          status: 'queued',
          designRequest,
          message: [
            'Design pass queued.',
            'The canvas opens beside the conversation and the design pass starts as soon as this reply ends.',
            'End this reply now with one short sentence; do not draw the design or implement it in code in this turn.'
          ].join(' ')
        }
      }
    }
  })
}

export function buildDesignOpenLocalTools(): LocalTool[] {
  return [createDesignOpenTool()]
}
