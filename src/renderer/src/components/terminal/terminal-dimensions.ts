import { TERMINAL_MAX_COLS, TERMINAL_MAX_ROWS } from '@shared/terminal'
import type { TerminalResizePayload } from '@shared/terminal'

type Dimensions = { cols: number; rows: number }
type DimensionSource = { proposeDimensions(): Dimensions | undefined }
type TerminalGrid = Dimensions & { resize(cols: number, rows: number): void }

export function validTerminalDimensions(value: Dimensions | undefined): value is Dimensions {
  return Boolean(value && Number.isSafeInteger(value.cols) && Number.isSafeInteger(value.rows)
    && value.cols > 0 && value.cols <= TERMINAL_MAX_COLS
    && value.rows > 0 && value.rows <= TERMINAL_MAX_ROWS)
}

/** Hidden panels and font measurement during mounting cannot provide a grid yet. */
export function fitVisibleTerminal(
  container: HTMLElement | null,
  source: DimensionSource | null,
  terminal: TerminalGrid | null
): Dimensions | undefined {
  if (!container?.isConnected || !source || !terminal) return undefined
  const bounds = container.getBoundingClientRect()
  if (!(bounds.width > 0 && bounds.height > 0)) return undefined
  try {
    const dimensions = source.proposeDimensions()
    if (!validTerminalDimensions(dimensions)) return undefined
    if (terminal.cols !== dimensions.cols || terminal.rows !== dimensions.rows) {
      terminal.resize(dimensions.cols, dimensions.rows)
    }
    return dimensions
  } catch {
    // xterm may be disposed or not yet have measured its font; the next layout retries.
    return undefined
  }
}

export async function resizeTerminalSession(
  resize: (payload: TerminalResizePayload) => Promise<boolean>,
  sessionId: string,
  dimensions: Dimensions | undefined,
  onError: (message: string) => void
): Promise<void> {
  if (!validTerminalDimensions(dimensions)) return
  try {
    await resize({ sessionId, cols: dimensions.cols, rows: dimensions.rows })
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error))
  }
}
