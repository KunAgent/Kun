import {
  designCanvasReceiptKey,
  designToolOutput
} from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const DESIGN_APPLY_EXCALIDRAW_TOOL_NAME = 'design_apply_excalidraw'

const APPLY_OP = { op: 'apply-excalidraw' } as const

export function createDesignApplyExcalidrawTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
    description: [
      'Reload the open Excalidraw board from its canonical excalidraw.json and export a PNG sidecar for visual checks.',
      'Call this after write or edit of that scene file. Do not pass the JSON here.',
      'Accepted means the renderer received the request; wait for the canvas receipt before treating the board or PNG as applied.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) => context.guiExcalidrawCanvas === true,
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    execute: async (_args, context) => {
      const ops = [APPLY_OP]
      return designToolOutput(DESIGN_APPLY_EXCALIDRAW_TOOL_NAME, 'apply_excalidraw', ops, {
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
