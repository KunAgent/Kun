import { truncateToWidth, visibleWidth } from './ansi-text.js'
import type { TuiGraphBoardNode, TuiGraphBoardProjection } from './graph-mode.js'
import { wrapText } from './layout.js'
import { sanitizeTerminalText } from './safe-text.js'
import { sectionLabel, selectionRow, visual } from './visual-system.js'

const { strong: bold, muted: dim, focus: cyan, success: green, warning: yellow, danger: red } = visual

export type GraphBoardRenderedLine = {
  text: string
  nodeId?: string
}

export function graphBoardRows(
  board: TuiGraphBoardProjection,
  width: number,
  topology: boolean
): GraphBoardRenderedLine[] {
  const rows: GraphBoardRenderedLine[] = []
  for (const phase of board.phases) {
    rows.push({ text: sectionLabel(`Phase ${phase.order + 1} · ${phase.title}`, width) })
    for (const node of phase.nodes) {
      if (topology && node.dependencies.length) {
        const dependencies = node.dependencies.map((edge) =>
          `${edge.from} ─${edge.label}→ ${node.id}`
        ).join('  ')
        rows.push({ text: truncateToWidth(`   ${dim(dependencies)}`, width) })
      }
      rows.push({
        text: selectionRow(
          `${graphNodeMarker(node)} ${sanitizeTerminalText(node.id)}  ${sanitizeTerminalText(node.title)}`,
          `${node.status} · ${sanitizeTerminalText(node.assignment)}`,
          width,
          node.id === board.selectedNodeId,
          0
        ),
        nodeId: node.id
      })
      if (topology && node.dependents.length) {
        const outgoing = node.dependents.map((edge) =>
          `${node.id} ─${edge.label}→ ${edge.to}`
        ).join('  ')
        rows.push({ text: truncateToWidth(`   ${dim(outgoing)}`, width) })
      }
    }
  }
  return rows
}

export function graphInspectorRows(node: TuiGraphBoardNode, width: number): string[] {
  const dependencies = node.dependencies.length
    ? node.dependencies.map((edge) => `${edge.from} (${edge.label})`).join(', ')
    : 'none'
  const rows = [
    sectionLabel(`Node ${node.id}`, width),
    ` ${graphNodeMarker(node)} ${bold(sanitizeTerminalText(node.title))}`,
    ` ${dim('Status')}   ${graphNodeStatusText(node.status)}`,
    ` ${dim('Phase')}    ${sanitizeTerminalText(node.phaseTitle)}`,
    ` ${dim('Agent')}    ${sanitizeTerminalText(node.assignment)}`,
    ` ${dim('Attempt')}  ${node.attemptNumber
      ? `${node.attemptNumber}${node.attemptStatus ? ` · ${node.attemptStatus}` : ''}`
      : 'not started'}`,
    ` ${dim('Depends')}  ${sanitizeTerminalText(dependencies)}`,
    '',
    ` ${dim('Objective')}`,
    ...wrapText(sanitizeTerminalText(node.objective), Math.max(8, width - 2))
      .slice(0, 4)
      .map((line) => ` ${line}`),
    ...(node.progressSummary
      ? ['', ` ${dim('Progress')}`, ...wrapText(
          sanitizeTerminalText(node.progressSummary),
          Math.max(8, width - 2)
        ).slice(0, 2).map((line) => ` ${line}`)]
      : []),
    ...(node.lastTransitionReason
      ? ['', ` ${dim('Latest')}`, ...wrapText(
          sanitizeTerminalText(node.lastTransitionReason),
          Math.max(8, width - 2)
        ).slice(0, 2).map((line) => ` ${line}`)]
      : []),
    ...(node.childThreadId
      ? ['', ` ${dim('Worker')}   ${sanitizeTerminalText(node.childThreadId)}`]
      : [])
  ]
  return rows.map((line) => truncateToWidth(line, width))
}

export function graphCompactInspectorRows(node: TuiGraphBoardNode, width: number): string[] {
  const dependencies = node.dependencies.length
    ? node.dependencies.map((edge) => `${edge.from} (${edge.label})`).join(', ')
    : 'none'
  const rows = [
    sectionLabel(`Node ${node.id}`, width),
    ` ${graphNodeMarker(node)} ${bold(sanitizeTerminalText(node.title))} · ${graphNodeStatusText(node.status)}`,
    ` ${dim('Agent')} ${sanitizeTerminalText(node.assignment)} · ${dim('Attempt')} ${
      node.attemptNumber
        ? `${node.attemptNumber}${node.attemptStatus ? ` (${node.attemptStatus})` : ''}`
        : 'not started'
    }`,
    ` ${dim('Depends')} ${sanitizeTerminalText(dependencies)}`,
    ` ${dim('Latest')} ${sanitizeTerminalText(node.lastTransitionReason ?? 'No transition reason recorded.')}`,
    ` ${dim('Worker')} ${sanitizeTerminalText(node.childThreadId ?? 'not available')}`
  ]
  return rows.map((line) => truncateToWidth(line, width))
}

export function visibleGraphBoardRows(
  rows: GraphBoardRenderedLine[],
  selectedNodeId: string,
  limit: number
): GraphBoardRenderedLine[] {
  if (rows.length <= limit) return rows
  const selectedRow = Math.max(0, rows.findIndex((row) => row.nodeId === selectedNodeId))
  const start = Math.max(0, Math.min(
    selectedRow - Math.floor(limit / 2),
    rows.length - limit
  ))
  return rows.slice(start, start + limit)
}

export function joinGraphColumns(
  left: string,
  right: string,
  leftWidth: number,
  rightWidth: number
): string {
  const clippedLeft = truncateToWidth(left, leftWidth)
  const paddedLeft = `${clippedLeft}${' '.repeat(Math.max(0, leftWidth - visibleWidth(clippedLeft)))}`
  return `${paddedLeft} ${dim('│')} ${truncateToWidth(right, rightWidth)}`
}

export function graphNodeMarker(node: TuiGraphBoardNode): string {
  switch (node.status) {
    case 'accepted': return green(node.marker)
    case 'failed':
    case 'blocked': return red(node.marker)
    case 'queued':
    case 'repair_required': return yellow(node.marker)
    case 'running':
    case 'submitted':
    case 'reviewing': return cyan(node.marker)
    default: return dim(node.marker)
  }
}

export function graphNodeStatusText(status: TuiGraphBoardNode['status']): string {
  if (status === 'accepted') return green(status)
  if (status === 'failed' || status === 'blocked') return red(status)
  if (status === 'queued' || status === 'repair_required') return yellow(status)
  if (status === 'running' || status === 'submitted' || status === 'reviewing') {
    return cyan(status)
  }
  return dim(status)
}

export function graphRunStatusText(status: TuiGraphBoardProjection['status']): string {
  if (status === 'completed') return green(status)
  if (status === 'failed' || status === 'cancelled') return red(status)
  if (status === 'paused' || status === 'awaiting_human') return yellow(status)
  return cyan(status)
}
