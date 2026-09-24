import { createHash } from 'node:crypto'
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

const ROOM_WHITEBOARD_DIR = '.kun-whiteboards'

export const DEFAULT_ROOM_BOARD_ID = 'room'

const BOARD_ID_SCHEMA = {
  type: 'string',
  pattern: '^[a-zA-Z0-9_-]{1,64}$',
  description: 'Optional Work or private-chat room whiteboard id. The board artifact lives at .kun-whiteboards/<boardId>/; omit it to use the board bound to this conversation.'
} as const

const BOARD_ID_ERROR = 'boardId must match ^[a-zA-Z0-9_-]{1,64}$'

const EXPORT_PATH_SCHEMA = {
  type: 'string',
  // Keep the pattern escape-free: some providers validate JSON Schema
  // `pattern` with strict regex engines that reject `\0`-style escapes.
  pattern: '^.+\\.png$',
  maxLength: 300,
  description:
    'Optional workspace-relative .png path (for example papers/<id>/assets/<name>.png). After the excalidraw.png sidecar is exported, the renderer writes a second PNG copy there so Markdown can embed it. Must not be absolute, contain .., or live under .kun-whiteboards/.'
} as const

const EXPORT_PATH_ERROR =
  'exportPath must be a workspace-relative .png path without .. and must not live under .kun-whiteboards/'

export function normalizeExcalidrawExportPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim().replace(/\\/g, '/')
  const normalized = trimmed.replace(/\/+/g, '/').replace(/^\.\//, '')
  if (
    !normalized ||
    normalized.length > 300 ||
    /^([a-zA-Z]:)?\//.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized === ROOM_WHITEBOARD_DIR ||
    normalized.startsWith(`${ROOM_WHITEBOARD_DIR}/`) ||
    normalized.split('/').some((segment) => segment.startsWith('.')) ||
    !/\.png$/i.test(normalized)
  ) {
    return undefined
  }
  return normalized
}

function isRoomBoard(context: { guiRoomExcalidrawCanvas?: boolean } | undefined): boolean {
  return context?.guiRoomExcalidrawCanvas === true
}

function resolveRoomBoardId(
  boardId: string | undefined,
  room: boolean,
  threadId: string | undefined,
  workspace: string | undefined
): string | undefined {
  if (!room) return boardId
  const namespace = `room-${createHash('sha256')
    .update(`${threadId ?? ''}\0${workspace ?? ''}`)
    .digest('hex')
    .slice(0, 12)}`
  if (!boardId || boardId === DEFAULT_ROOM_BOARD_ID) return namespace
  if (boardId === namespace || boardId.startsWith(`${namespace}-`)) return boardId
  return `${namespace}-${boardId}`.slice(0, 64)
}

function roomBoardPaths(boardId: string): { scenePath: string; pngPath: string } {
  return {
    scenePath: `${ROOM_WHITEBOARD_DIR}/${boardId}/excalidraw.json`,
    pngPath: `${ROOM_WHITEBOARD_DIR}/${boardId}/excalidraw.png`
  }
}

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
      context.guiExcalidrawCanvas === true ||
      context.agentSurface === 'write' ||
      context.guiRoomExcalidrawCanvas === true,
    inputSchema: {
      type: 'object',
      properties: {
        boardId: BOARD_ID_SCHEMA,
        exportPath: EXPORT_PATH_SCHEMA
      },
      additionalProperties: false
    },
    execute: async (args, context) => {
      const room = isRoomBoard(context)
      const rawBoardId = stringArg(args?.boardId)
      if (rawBoardId && !BOARD_ID_PATTERN.test(rawBoardId)) return designToolError(BOARD_ID_ERROR)
      if (rawBoardId && context?.agentSurface !== 'write' && !room) {
        return designToolError('boardId targets a Work whiteboard and is only supported on the Work surface')
      }
      const boardId = resolveRoomBoardId(
        rawBoardId,
        room,
        context?.threadId,
        context?.workspace
      )
      const rawExportPath = stringArg(args?.exportPath)
      const exportPath = normalizeExcalidrawExportPath(rawExportPath)
      if (rawExportPath && !exportPath) return designToolError(EXPORT_PATH_ERROR)
      const ops = [{
        op: 'apply-excalidraw',
        ...(boardId ? { boardId } : {}),
        ...(exportPath ? { exportPath } : {})
      }]
      const extras: Record<string, unknown> = {
        status: 'accepted',
        ...(boardId ? { boardId } : {}),
        ...(exportPath ? { exportPath } : {}),
        ...(context?.agentSurface ? { surface: room ? 'room' : context.agentSurface } : {}),
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          ops
        )
      }
      if (room && context?.workspace && boardId) {
        extras.scope = 'room'
        extras.workspaceRoot = context.workspace
        Object.assign(extras, roomBoardPaths(boardId))
      }
      return designToolOutput(DESIGN_APPLY_EXCALIDRAW_TOOL_NAME, 'apply_excalidraw', ops, extras)
    }
  })
}

export function createDesignOpenExcalidrawTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: DESIGN_OPEN_EXCALIDRAW_TOOL_NAME,
    description: [
      'Open or create the Excalidraw whiteboard bound to this Work conversation or private-chat room.',
      'Its canonical scene lives at .kun-whiteboards/<boardId>/excalidraw.json; design_apply_excalidraw reloads that file and exports .kun-whiteboards/<boardId>/excalidraw.png.',
      'Call this before writing the scene file when no Excalidraw board is open. Pass a stable boardId slug to choose the artifact directory yourself; omit it to reuse the board bound to this conversation.',
      'Accepted means the renderer received the request; wait for the canvas receipt before treating the board as open.'
    ].join(' '),
    toolKind: 'tool_call',
    policy: 'auto',
    shouldAdvertise: (context) =>
      context.agentSurface === 'write' || context.guiRoomExcalidrawCanvas === true,
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
      const room = isRoomBoard(context)
      const rawBoardId = stringArg(args?.boardId)
      const title = stringArg(args?.title)
      if (rawBoardId && !BOARD_ID_PATTERN.test(rawBoardId)) return designToolError(BOARD_ID_ERROR)
      const boardId = resolveRoomBoardId(
        rawBoardId,
        room,
        context?.threadId,
        context?.workspace
      )
      const ops = [{
        op: 'open-excalidraw',
        ...(boardId ? { boardId } : {}),
        ...(title ? { title } : {})
      }]
      const extras: Record<string, unknown> = {
        status: 'accepted',
        ...(boardId ? { boardId } : {}),
        ...(title ? { title } : {}),
        ...(context?.agentSurface ? { surface: room ? 'room' : context.agentSurface } : {}),
        receiptKey: designCanvasReceiptKey(
          context?.threadId,
          context?.turnId,
          context?.activeToolCallId,
          ops
        )
      }
      if (room && context?.workspace && boardId) {
        extras.scope = 'room'
        extras.workspaceRoot = context.workspace
        Object.assign(extras, roomBoardPaths(boardId))
      }
      return designToolOutput(DESIGN_OPEN_EXCALIDRAW_TOOL_NAME, 'open_excalidraw', ops, extras)
    }
  })
}
