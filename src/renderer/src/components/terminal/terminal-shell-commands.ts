import type { IDecoration, IMarker, Terminal } from '@xterm/xterm'

/**
 * Command tracking from shell integration (OSC 633, see
 * src/main/terminal/terminal-shell-integration.ts). Each command gets a gutter
 * mark on its prompt line: green when it succeeded, red when it failed, a ring
 * while it runs. Ctrl-C (130) and unknown codes stay neutral.
 */
export type ShellCommandState = 'running' | 'ok' | 'failed' | 'neutral'

export type ShellCommandRecord = {
  id: number
  command: string
  cwd?: string
  promptMarker?: IMarker
  outputMarker?: IMarker
  endMarker?: IMarker
  startedAt: number
  finishedAt?: number
  exitCode?: number | null
  state: ShellCommandState
  decoration?: IDecoration
  element?: HTMLElement
}

export type ShellCommandCallbacks = {
  onPrompt?: () => void
  onCommandStart?: (record: ShellCommandRecord) => void
  onCommandFinish?: (record: ShellCommandRecord) => void
  onCwd?: (cwd: string) => void
  onMarkClick?: (record: ShellCommandRecord, anchor: DOMRect) => void
  describeMark?: (record: ShellCommandRecord) => string
}

const MAX_RECORDS = 300
const INTERRUPTED_EXIT_CODES = new Set([130])

/** Undo the escaping the hooks apply: `\\` and `\xHH`. */
export function decodeOscValue(value: string): string {
  let out = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '\\' && value[index + 1] === '\\') {
      out += '\\'
      index += 1
    } else if (char === '\\' && value[index + 1] === 'x' && /^[0-9a-fA-F]{2}$/.test(value.slice(index + 2, index + 4))) {
      out += String.fromCharCode(Number.parseInt(value.slice(index + 2, index + 4), 16))
      index += 3
    } else {
      out += char
    }
  }
  return out
}

export function commandStateFor(exitCode: number | null | undefined): ShellCommandState {
  if (typeof exitCode !== 'number' || INTERRUPTED_EXIT_CODES.has(exitCode)) return 'neutral'
  return exitCode === 0 ? 'ok' : 'failed'
}

/** Text of buffer rows [start, end), with soft-wrapped rows joined. */
export function readBufferLines(term: Terminal, start: number, end: number): string[] {
  const buffer = term.buffer.active
  const lines: string[] = []
  for (let row = Math.max(0, start); row < Math.min(end, buffer.length); row += 1) {
    const line = buffer.getLine(row)
    if (!line) continue
    const text = line.translateToString(true)
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text
    else lines.push(text)
  }
  return lines
}

export class ShellCommandTracker {
  readonly records: ShellCommandRecord[] = []
  private pendingCommand = ''
  private active: ShellCommandRecord | null = null
  private sequence = 0
  private cwd: string | undefined
  private readonly disposeHandler: { dispose(): void }

  constructor(private readonly term: Terminal, private readonly callbacks: ShellCommandCallbacks) {
    this.disposeHandler = term.parser.registerOscHandler(633, (data) => this.handle(data))
  }

  /** Parse one OSC 633 payload; returns true when consumed. */
  handle(data: string): boolean {
    const separator = data.indexOf(';')
    const kind = separator === -1 ? data : data.slice(0, separator)
    const rest = separator === -1 ? '' : data.slice(separator + 1)
    if (kind === 'A') {
      this.callbacks.onPrompt?.()
    } else if (kind === 'E') {
      this.pendingCommand = decodeOscValue(rest).trim()
    } else if (kind === 'C') {
      this.startCommand()
    } else if (kind === 'D') {
      const code = /^-?\d+$/.test(rest) ? Number(rest) : null
      this.finishCommand(code)
    } else if (kind === 'P' && rest.startsWith('Cwd=')) {
      this.cwd = decodeOscValue(rest.slice(4))
      this.callbacks.onCwd?.(this.cwd)
    }
    return true
  }

  get running(): ShellCommandRecord | null {
    return this.active
  }

  private startCommand(): void {
    if (this.active) this.finishCommand(null)
    const record: ShellCommandRecord = {
      id: ++this.sequence,
      command: this.pendingCommand,
      cwd: this.cwd,
      startedAt: Date.now(),
      state: 'running',
      // The command was typed on the row above the cursor; output starts here.
      promptMarker: this.term.registerMarker(-1),
      outputMarker: this.term.registerMarker(0)
    }
    this.pendingCommand = ''
    this.active = record
    this.records.push(record)
    this.decorate(record)
    this.trim()
    this.callbacks.onCommandStart?.(record)
  }

  private finishCommand(exitCode: number | null): void {
    const record = this.active
    if (!record) return
    this.active = null
    record.finishedAt = Date.now()
    record.exitCode = exitCode
    record.state = commandStateFor(exitCode)
    record.endMarker = this.term.registerMarker(0)
    this.paint(record)
    this.callbacks.onCommandFinish?.(record)
  }

  private decorate(record: ShellCommandRecord): void {
    const marker = record.promptMarker
    if (!marker || marker.isDisposed) return
    const decoration = this.term.registerDecoration({ marker, x: 0, width: 1, layer: 'top' })
    if (!decoration) return
    record.decoration = decoration
    decoration.onRender((element) => {
      if (record.element !== element) {
        record.element = element
        element.addEventListener('mousedown', (event) => {
          event.preventDefault()
          event.stopPropagation()
          this.callbacks.onMarkClick?.(record, element.getBoundingClientRect())
        })
      }
      this.paint(record)
    })
  }

  private paint(record: ShellCommandRecord): void {
    const element = record.element
    if (!element) return
    element.className = element.className
      .split(' ')
      .filter((name) => name && !name.startsWith('kun-terminal-mark'))
      .concat(['kun-terminal-mark', `kun-terminal-mark-${record.state}`])
      .join(' ')
    element.title = this.callbacks.describeMark?.(record) ?? record.command
  }

  private trim(): void {
    while (this.records.length > MAX_RECORDS) {
      const old = this.records.shift()
      old?.decoration?.dispose()
      old?.promptMarker?.dispose()
      old?.outputMarker?.dispose()
      old?.endMarker?.dispose()
    }
  }

  find(id: number): ShellCommandRecord | undefined {
    return this.records.find((record) => record.id === id)
  }

  /** Output lines of a finished (or running) command; empty once scrolled away. */
  output(record: ShellCommandRecord): string[] {
    const start = record.outputMarker
    if (!start || start.isDisposed || start.line < 0) return []
    const end = record.endMarker && !record.endMarker.isDisposed && record.endMarker.line >= 0
      ? record.endMarker.line
      : this.term.buffer.active.length
    const lines = readBufferLines(this.term, start.line, end)
    while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop()
    return lines
  }

  /** Scroll to the previous/next command prompt relative to the viewport top. */
  jump(direction: 'previous' | 'next'): boolean {
    const top = this.term.buffer.active.viewportY
    const lines = this.records
      .map((record) => record.promptMarker)
      .filter((marker): marker is IMarker => Boolean(marker && !marker.isDisposed && marker.line >= 0))
      .map((marker) => marker.line)
    const target = direction === 'previous'
      ? [...lines].reverse().find((line) => line < top)
      : lines.find((line) => line > top)
    if (target === undefined) return false
    this.term.scrollToLine(target)
    return true
  }

  dispose(): void {
    this.disposeHandler.dispose()
    for (const record of this.records.splice(0)) {
      record.decoration?.dispose()
      record.promptMarker?.dispose()
      record.outputMarker?.dispose()
      record.endMarker?.dispose()
    }
  }
}
