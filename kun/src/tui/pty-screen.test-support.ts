import headless from '@xterm/headless'
import { findTuiNode, type TuiNodeCandidate } from './tui-node.js'

/**
 * Emulated terminal for PTY tests. The opentui renderer repaints only the
 * cells that changed, so visible text is asserted on an emulated screen
 * rather than on substrings of the raw output stream.
 */
export class PtyScreen {
  private readonly terminal: headless.Terminal
  private pending = Promise.resolve()
  raw = ''

  constructor(cols: number, rows: number) {
    this.terminal = new headless.Terminal({ cols, rows, scrollback: 5_000, allowProposedApi: true })
  }

  write(data: string): void {
    this.raw += data
    const terminal = this.terminal
    this.pending = this.pending.then(() => new Promise<void>((resolve) => terminal.write(data, resolve)))
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows)
  }

  /** Answers terminal queries (cursor position, device attributes). */
  onReply(listener: (data: string) => void): void {
    this.terminal.onData(listener)
  }

  /** Scrollback plus the visible screen, one string per row. */
  lines(): string[] {
    const buffer = this.terminal.buffer.active
    const lines: string[] = []
    for (let index = 0; index < buffer.length; index += 1) {
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
    }
    return lines
  }

  /** Visible rows only. */
  view(): string[] {
    const buffer = this.terminal.buffer.active
    return this.lines().slice(buffer.baseY, buffer.baseY + this.terminal.rows)
  }

  text(): string {
    return this.lines().join('\n')
  }

  async settled(): Promise<void> {
    await this.pending
  }
}

/** Node >= 26.4 interpreter for the renderer, or undefined to skip PTY tests. */
export function ptyTuiNode(): TuiNodeCandidate | undefined {
  return findTuiNode(process.env)
}
