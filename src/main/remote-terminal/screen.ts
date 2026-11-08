import { TERMINAL_LIMITS } from '@kun/remote-protocol'

/** Snapshots are emulator states, never an arbitrary suffix of raw ANSI output. */
export type TerminalScreen = {
  readonly pendingBytes?: number
  write(data: string): void
  resize(cols: number, rows: number): void
  flush(): Promise<void>
  /** Ordered with writes: later output cannot enter this snapshot. */
  capture(): Promise<string>
  serialize(): string
  dispose(): void
}
export type TerminalScreenFactory = { create(cols: number, rows: number): TerminalScreen; fullScreen?: boolean }
export const SCREEN_SCROLLBACK = 200
const RESET = '\u001bc'
const CLEAR = '\u001b[0m\u001b[2J\u001b[H'

export function utf8Length(value: string): number { return Buffer.byteLength(value, 'utf8') }

/** A truncated OSC/DCS may contain line breaks or ESC, so neither is a safe cut point. */
export function safeReplay(value: string, limit = TERMINAL_LIMITS.snapshotBytes): string {
  const prefix = RESET + CLEAR
  if (utf8Length(prefix) > limit) return ''
  return utf8Length(prefix) + utf8Length(value) <= limit ? prefix + value : prefix
}

class ReplayScreen implements TerminalScreen {
  private text = ''
  private truncated = false
  write(data: string) {
    if (this.truncated) return
    if (utf8Length(this.text) + utf8Length(data) > TERMINAL_LIMITS.snapshotBytes) {
      this.text = ''; this.truncated = true
    } else this.text += data
  }
  resize() {}
  flush() { return Promise.resolve() }
  capture() { return Promise.resolve(this.serialize()) }
  serialize() { return safeReplay(this.text) }
  dispose() { this.text = ''; this.truncated = true }
}

type HeadlessTerminal = new (options: { cols: number; rows: number; scrollback?: number; allowProposedApi?: boolean }) => {
  write(data: string, callback?: () => void): void
  resize(cols: number, rows: number): void
  dispose(): void
  loadAddon(addon: unknown): void
}
type Serializer = { serialize(options?: { scrollback?: number }): string }
type AddonConstructor = new () => Serializer

function moduleConstructor<T>(module: unknown, name: string): T | undefined {
  // Node ESM exposes some CommonJS builds only through the default namespace.
  const namespace = module as Record<string, unknown> & { default?: Record<string, unknown> }
  const candidate = namespace[name] ?? namespace.default?.[name]
  return typeof candidate === 'function' ? candidate as T : undefined
}

export class XtermScreen implements TerminalScreen {
  private applied: Promise<void> = Promise.resolve()
  private pending = 0
  private operations = 0
  private disposed = false
  get pendingBytes() { return this.pending }
  constructor(private term: InstanceType<HeadlessTerminal>, private addon: Serializer) {}

  private enqueue<T>(bytes: number, operation: () => T | Promise<T>): Promise<T> {
    if (this.disposed) throw new Error('TERMINAL_SCREEN_CLOSED')
    if (this.pending + bytes > TERMINAL_LIMITS.outputBytes || this.operations >= 128)
      throw new Error('TERMINAL_PARSER_OVERFLOW')
    this.pending += bytes; this.operations++
    const result = this.applied.then(operation)
    this.applied = result.then(() => undefined).finally(() => { this.pending -= bytes; this.operations-- })
    // Preserve failure for capture/flush without an unhandled parser rejection.
    void this.applied.catch(() => {})
    return result
  }
  write(data: string) {
    void this.enqueue(utf8Length(data), () => new Promise<void>((resolve, reject) => {
      try { this.term.write(data, resolve) } catch (error) { reject(error) }
    })).catch(() => {})
  }
  resize(cols: number, rows: number) { void this.enqueue(0, () => this.term.resize(cols, rows)).catch(() => {}) }
  flush() { return this.applied }
  capture() { return this.enqueue(0, () => this.serialize()) }
  serialize() {
    for (const scrollback of [SCREEN_SCROLLBACK, 0]) {
      const value = this.addon.serialize({ scrollback })
      if (typeof value === 'string' && utf8Length(value) <= TERMINAL_LIMITS.snapshotBytes) return value
    }
    // Even a no-scrollback screen can exceed the wire limit at maximum geometry.
    return RESET + CLEAR
  }
  dispose() {
    this.disposed = true
    // Let accepted parser callbacks finish before disposing their terminal.
    void this.applied.catch(() => {}).then(() => { this.term.dispose() })
  }
}

export function createReplayScreens(): TerminalScreenFactory {
  return { fullScreen: false, create: () => new ReplayScreen() }
}

/** An unavailable real emulator must not advertise full-TUI support. */
export async function loadTerminalScreens(): Promise<TerminalScreenFactory> {
  try {
    const [headless, serialize] = await Promise.all([import('@xterm/headless'), import('@xterm/addon-serialize')])
    const Terminal = moduleConstructor<HeadlessTerminal>(headless, 'Terminal')
    const SerializeAddon = moduleConstructor<AddonConstructor>(serialize, 'SerializeAddon')
    if (!Terminal || !SerializeAddon) return createReplayScreens()
    return { fullScreen: true, create(cols, rows) {
      const term = new Terminal({ cols, rows, scrollback: SCREEN_SCROLLBACK, allowProposedApi: true })
      try {
        const addon = new SerializeAddon()
        term.loadAddon(addon)
        return new XtermScreen(term, addon)
      } catch (error) { term.dispose(); throw error }
    } }
  } catch { return createReplayScreens() }
}
