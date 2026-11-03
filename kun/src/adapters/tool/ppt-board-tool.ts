import { isAbsolute, resolve } from 'node:path'
import { convertPptdToCanvas, sliceOpsForBatch } from '../../ppt/pptd-to-canvas.js'
import { LocalToolHost, type LocalTool } from './local-tool-host.js'

export const PPT_TO_BOARD_TOOL_NAME = 'ppt_to_board'
export const PPT_TO_BOARD_PROVIDER_ID = 'ppt-board'

/**
 * `ppt_to_board`: lays a PPTD deck project out on the Design whiteboard as
 * ShapeOps (one screen per page + background/element shapes). It is a
 * read-only conversion — nothing is written to disk — and is gated by the
 * same `guiDesignCanvas` context flag as the design tools.
 *
 * Verdict B contract: child agent design-tool results never reach the canvas
 * (renderer only subscribes to the parent thread), so the PPT child returns a
 * boardSpec summary and the MAIN agent replays this tool in the whiteboard /
 * Design context. Large decks page through explicit `batch` indexes; keep
 * calling with `batch = batch + 1` until `more` is false.
 */
export function buildPptBoardLocalTools(): LocalTool[] {
  return [createPptToBoardTool()]
}

const PPT_TO_BOARD_DESCRIPTION = [
  'Lay a PPTD deck project (deck.pptd + pages/*.page) out on the Design whiteboard as editable screens.',
  'Use this when the user asks to show or edit a presentation as shapes on the board; review previews come from `ppt_preview` instead.',
  'Each page becomes a screen frame; text, shapes, tables and images are converted into editable shapes.',
  'The board is created lazily on the first screen and the user can then edit text, fonts, colors and images directly.',
  'Call it repeatedly with `batch` = 0, 1, 2, ... until `more` is false when the deck is large (each batch is capped at 100 ops).'
].join(' ')

function createPptToBoardTool(): LocalTool {
  return LocalToolHost.defineTool({
    name: PPT_TO_BOARD_TOOL_NAME,
    description: PPT_TO_BOARD_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        pptdPath: {
          type: 'string',
          description: 'Workspace-relative path to the deck.pptd file (for example deck/yu7.pptd).'
        },
        boardTitle: {
          type: 'string',
          description: 'Optional board title override. Defaults to the deck title.'
        },
        layout: {
          type: 'string',
          enum: ['grid', 'row'],
          description: "Page layout: 'grid' (2 columns) or 'row' (single row). Defaults to grid."
        },
        batch: {
          type: 'integer',
          description: '0-based op batch index. Omit for the first batch; keep calling with batch+1 while more is true.'
        }
      },
      required: ['pptdPath'],
      additionalProperties: false
    },
    policy: 'auto',
    sideEffect: 'read-only',
    shouldAdvertise: (context) => context.guiDesignCanvas === true,
    execute: async (args, context) => {
      const pptdPath = typeof args.pptdPath === 'string' ? args.pptdPath.trim() : ''
      if (!pptdPath) {
        return { output: { error: 'pptdPath is required' }, isError: true }
      }
      const workspace = context.workspace
      const absolute = isAbsolute(pptdPath)
        ? pptdPath
        : resolve(workspace ?? process.cwd(), pptdPath)
      try {
        const result = await convertPptdToCanvas(absolute, {
          workspaceRoot: workspace,
          layout: args.layout === 'row' ? 'row' : 'grid'
        })
        const batch =
          typeof args.batch === 'number' && Number.isInteger(args.batch) && args.batch >= 0
            ? args.batch
            : 0
        const sliced = sliceOpsForBatch(result.ops, batch)
        const boardTitle =
          typeof args.boardTitle === 'string' && args.boardTitle.trim()
            ? args.boardTitle.trim()
            : result.boardTitle
        return {
          output: {
            ops: sliced.ops,
            boardTitle,
            pageCount: result.pageCount,
            batch: sliced.batch,
            batchCount: sliced.batchCount,
            more: sliced.more,
            ...(sliced.more
              ? { hint: `Call ppt_to_board again with batch=${sliced.batch + 1} to apply the remaining ops.` }
              : {})
          },
          isError: false
        }
      } catch (error) {
        return {
          output: {
            error: error instanceof Error ? error.message : String(error)
          },
          isError: true
        }
      }
    }
  })
}
