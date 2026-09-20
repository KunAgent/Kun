import {
  designCanvasReceiptKey,
  designToolError,
  designToolOutput,
  stringArg
} from './design-canvas-normalization.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const DESIGN_APPLY_EXCALIDRAW_TOOL_NAME = 'design_apply_excalidraw'
export const DESIGN_OPEN_EXCALIDRAW_TOOL_NAME = 'design_open_excalidraw'

const BOARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/

const BOARD_ID_SCHEMA = {
  type: 'string',
  pattern: '^[a-zA-Z0-9_-]{1,64}$',
  description: 'Optional Work whiteboard id. The board artifact lives at .kun-whiteboards/<boardId>/; omit it to use the board bound to this conversation.'
} as const

const BOARD_ID_ERROR = 'boardId must match ^[a-zA-Z0-9_-]{1,64}$'

export function createDesignApplyExcalidrawTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_APPLY_EXCALIDRAW_TOOL_NAME,
    description: [
      'Reload the Excalidraw board from its canonical .kun-whiteboards/<boardId>/excalidraw.json and export the excalidraw.png sidecar for visual checks.',
      'Call this after write or edit of that scene file. Do not pass the JSON here.',
      'On the Work surface the renderer opens the matching board when needed; call design_open_excalidraw first when no board exists yet.',
      'Accepted means the renderer received the request; wait for the canvas receipt before treating the board or PNG as applied.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) =>
      context.guiExcalidrawCanvas === true || context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: BOARD_ID_SCHEMA
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      const boardId = stringArg(args?.boardId)
      if (boardId && !BOARD_ID_PATTERN.test(boardId)) return designToolError(BOARD_ID_ERROR)
      if (boardId && context?.agentSurface !== 'write') {
        return designToolError('boardId targets a Work whiteboard and is only supported on the Work surface')
      }
      const ops = [{ op: 'apply-excalidraw', ...(boardId ? { boardId } : {}) }]
      return designToolOutput(DESIGN_APPLY_EXCALIDRAW_TOOL_NAME, 'apply_excalidraw', ops, {
        status: 'accepted',
        ...(boardId ? { boardId } : {}),
        ...(context?.agentSurface ? { surface: context.agentSurface } : {}),
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

export function createDesignOpenExcalidrawTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_OPEN_EXCALIDRAW_TOOL_NAME,
    description: [
      'Open or create the Excalidraw whiteboard bound to this Work conversation.',
      'Its canonical scene lives at .kun-whiteboards/<boardId>/excalidraw.json; design_apply_excalidraw reloads that file and exports .kun-whiteboards/<boardId>/excalidraw.png.',
      'Call this before writing the scene file when no Excalidraw board is open. Pass a stable boardId slug to choose the artifact directory yourself; omit it to reuse the board bound to this conversation.',
      'Accepted means the renderer received the request; wait for the canvas receipt before treating the board as open.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) => context.agentSurface === 'write',
    inputSchema: {
      type: 'object',
      properties: {
        boardId: BOARD_ID_SCHEMA,
        title: {
          type: 'string',
          minLength: 1,
          maxLength: 160,
          description: 'Optional title for a newly created board; ignored when the board already exists.'
        }
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      const boardId = stringArg(args?.boardId)
      const title = stringArg(args?.title)
      if (boardId && !BOARD_ID_PATTERN.test(boardId)) return designToolError(BOARD_ID_ERROR)
      const ops = [{
        op: 'open-excalidraw',
        ...(boardId ? { boardId } : {}),
        ...(title ? { title } : {})
      }]
      return designToolOutput(DESIGN_OPEN_EXCALIDRAW_TOOL_NAME, 'open_excalidraw', ops, {
        status: 'accepted',
        ...(boardId ? { boardId } : {}),
        ...(title ? { title } : {}),
        ...(context?.agentSurface ? { surface: context.agentSurface } : {}),
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
