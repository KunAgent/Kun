import { truncateToWidth } from '../ansi-text.js'
import type { TuiController, TuiControllerState } from '../controller.js'
import {
  graphBoardRows,
  graphCompactInspectorRows,
  graphInspectorRows,
  graphRunStatusText,
  joinGraphColumns,
  visibleGraphBoardRows,
  type GraphBoardRenderedLine
} from '../graph-board-format.js'
import { moveTuiGraphBoardSelection, projectTuiGraphBoard, type TuiGraphBoardProjection } from '../graph-mode.js'
import { isCancelKey, isKey, letter, printableText, type TuiKeyEvent } from '../keys.js'
import type { PageBlock, PageMouseEvent, PageSize, PageView, TuiPage } from '../page-model.js'
import { sanitizeTerminalText } from '../safe-text.js'
import { joinVisualSides, visual } from '../visual-system.js'
import type { Invalidate } from './page-kit.js'

const { muted: dim, danger: red } = visual

export class GraphBoardPage implements TuiPage {
  readonly kind = 'graph'
  private state: TuiControllerState
  private selectedId?: string
  private currentBoard?: TuiGraphBoardProjection
  private nodeIds: string[] = []

  constructor(private readonly input: {
    controller: TuiController
    state: TuiControllerState
    runId: string
    initialNodeId?: string
    close: () => void
    openWorker: (runId: string, nodeId: string, childThreadId: string) => void
    invalidate: Invalidate
  }) {
    this.state = input.state
    this.selectedId = input.initialNodeId
  }

  get runId(): string {
    return this.input.runId
  }

  selectedNodeId(): string {
    return this.currentBoard?.selectedNodeId ?? this.selectedId ?? ''
  }

  update(state: TuiControllerState): void {
    this.state = state
    this.input.invalidate()
  }

  view(size: PageSize): PageView {
    const run = this.state.graphRuns.find((candidate) => candidate.id === this.input.runId)
    if (!run) {
      return {
        path: ['KUN', 'Graph'],
        frame: 'popup',
        popupTitle: 'GRAPH',
        body: [{ kind: 'spacer' }, { kind: 'line', text: ` ${red('GraphRun is no longer available.')}` }],
        footer: [{ key: 'Esc', label: 'back' }]
      }
    }
    // The popup frame takes two border columns and one cell of padding per side.
    const inner = Math.max(44, Math.floor(size.width * 0.9) - 4)
    const board = projectTuiGraphBoard(run, {
      ...(this.selectedId ? { selectedNodeId: this.selectedId } : {}),
      width: inner,
      height: size.height
    })
    this.currentBoard = board
    this.selectedId = board.selectedNodeId
    const selected = board.nodes.find((node) => node.id === board.selectedNodeId)!
    const availableRows = Math.max(7, Math.floor(size.height * 0.78) - 7)
    const body: GraphBoardRenderedLine[] = [
      {
        text: joinVisualSides(
          ` ${graphRunStatusText(board.status)}  ${sanitizeTerminalText(board.title)}`,
          `${board.progress.accepted}/${board.progress.total} accepted · ${board.progress.activeAgents} agents · r${board.revision}`,
          inner
        )
      },
      { text: truncateToWidth(` ${dim('Goal')}  ${sanitizeTerminalText(board.goal)}`, inner) },
      { text: '' }
    ]
    if (board.renderMode === 'topology') {
      const inspectorWidth = Math.max(30, Math.min(42, Math.floor(inner * 0.36)))
      const graphWidth = Math.max(28, inner - inspectorWidth - 3)
      const graphRows = visibleGraphBoardRows(graphBoardRows(board, graphWidth, true), board.selectedNodeId, availableRows)
      const inspectorRows = graphInspectorRows(selected, inspectorWidth)
      const rowCount = Math.max(graphRows.length, Math.min(availableRows, inspectorRows.length))
      for (let index = 0; index < rowCount; index += 1) {
        const graphLine = graphRows[index]
        body.push({
          text: joinGraphColumns(graphLine?.text ?? '', inspectorRows[index] ?? '', graphWidth, inspectorWidth),
          ...(graphLine?.nodeId ? { nodeId: graphLine.nodeId } : {})
        })
      }
    } else {
      const compact = graphCompactInspectorRows(selected, inner)
      body.push(...visibleGraphBoardRows(graphBoardRows(board, inner, false), board.selectedNodeId, Math.max(4, availableRows - compact.length)))
      body.push(...compact.map((text) => ({ text })))
    }
    this.nodeIds = []
    const blocks = body.map((line): PageBlock => {
      if (!line.text) return { kind: 'spacer' }
      if (!line.nodeId) return { kind: 'line', text: line.text }
      this.nodeIds.push(line.nodeId)
      return { kind: 'line', text: line.text, index: this.nodeIds.length - 1 }
    })
    return {
      path: ['KUN', 'Graph'],
      frame: 'popup',
      popupTitle: `GRAPH · ${board.status}`,
      body: blocks,
      footer: [
        { key: '↑/↓', label: 'select' },
        { key: 'Enter', label: selected.childThreadId ? 'worker session' : 'worker unavailable' },
        { key: 'Esc', label: 'back' }
      ]
    }
  }

  handleKey(key: TuiKeyEvent): void {
    if (isCancelKey(key)) { this.input.close(); return }
    const board = this.currentBoard
    if (!board) return
    if (isKey(key, 'up') || letter(key) === 'k') this.selectedId = moveTuiGraphBoardSelection(board, -1)
    else if (isKey(key, 'down') || letter(key) === 'j') this.selectedId = moveTuiGraphBoardSelection(board, 1)
    else if (isKey(key, 'pageUp')) this.selectedId = moveTuiGraphBoardSelection(board, -5)
    else if (isKey(key, 'pageDown')) this.selectedId = moveTuiGraphBoardSelection(board, 5)
    else if (isKey(key, 'home') || printableText(key) === 'g') this.selectedId = board.nodes[0]?.id
    else if (isKey(key, 'end') || printableText(key) === 'G') this.selectedId = board.nodes.at(-1)?.id
    else if (isKey(key, 'enter')) { this.openSelectedWorker(board); return }
    else return
    this.input.invalidate()
  }

  handleMouse(event: PageMouseEvent): void {
    const board = this.currentBoard
    if (!board) return
    if (event.type === 'scroll') this.selectedId = moveTuiGraphBoardSelection(board, event.delta)
    else {
      const nodeId = this.nodeIds[event.index]
      if (!nodeId) return
      if (event.activate && nodeId === board.selectedNodeId) { this.openSelectedWorker(board); return }
      this.selectedId = nodeId
    }
    this.input.invalidate()
  }

  private openSelectedWorker(board: TuiGraphBoardProjection): void {
    const node = board.nodes.find((candidate) => candidate.id === board.selectedNodeId)
    if (!node?.childThreadId) {
      this.input.controller.notify('This Graph node does not have an available worker session yet.', 'error')
      return
    }
    this.input.openWorker(board.runId, node.id, node.childThreadId)
  }
}
