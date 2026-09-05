import type { HarnessCell } from './trajectory-harness-model'

export const HARNESS_ROW_HEIGHT = 30
export const HARNESS_COLLAPSED_HEIGHT = 20
export const HARNESS_TERMINAL_BOUNDARY_HEIGHT = 9
export const HARNESS_VIRTUALIZATION_THRESHOLD = 100
export const HARNESS_VIRTUAL_OVERSCAN = 12

export type HarnessVirtualRow = {
  key: string
  cell: HarnessCell
  height: number
}

export function harnessVirtualRows(cells: readonly HarnessCell[]): HarnessVirtualRow[] {
  return cells.map((cell) => ({
    key: encodeURIComponent(cell.id),
    cell,
    height: cell.requestOnly
      ? HARNESS_TERMINAL_BOUNDARY_HEIGHT
      : cell.collapsedSummary ? HARNESS_COLLAPSED_HEIGHT : HARNESS_ROW_HEIGHT
  }))
}
