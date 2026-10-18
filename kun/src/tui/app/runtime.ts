import { createCliRenderer, type CliRenderer, type CliRendererConfig } from '@opentui/core'
import type { TerminalPort } from '../session/session-types.js'

/** Fields of CliRenderer this module touches that are not public API. */
type SplitInternals = {
  renderOffset: number
  getSplitCursorSeedRows: () => number
  forceFullRepaintRequested?: boolean
}

function internals(renderer: CliRenderer): SplitInternals {
  return renderer as unknown as SplitInternals
}

export type RendererStreams = {
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
}

export async function createKunRenderer(footerHeight: number, streams: RendererStreams = {}): Promise<CliRenderer> {
  const config: CliRendererConfig = {
    ...(streams.stdin ? { stdin: streams.stdin } : {}),
    ...(streams.stdout ? { stdout: streams.stdout } : {}),
    // Kun is an inline application: finished output goes to the terminal's
    // own scrollback and only the composer region is redrawn.
    screenMode: 'split-footer',
    footerHeight,
    externalOutputMode: 'capture-stdout',
    consoleMode: 'disabled',
    // Erase only the composer region on exit; the transcript stays in scrollback.
    clearOnShutdown: true,
    openConsoleOnError: false,
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: false,
    autoFocus: false,
    targetFps: 30,
    maxFps: 60,
    useKittyKeyboard: {}
  }
  return createCliRenderer(config)
}

/**
 * Screen-mode controller for the inline (split-footer) surface.
 *
 * Two opentui behaviors are worked around here, both verified against a
 * headless xterm:
 *
 * 1. Growing a footer that already sits on the last terminal row scrolls the
 *    screen with `CSI n S`. xterm.js (VS Code, Cursor) and Windows Terminal
 *    do not save those rows to scrollback, so visible history would be lost.
 *    Growth is therefore only applied while there is free space below the
 *    footer; otherwise the footer keeps its height and the live window clips.
 * 2. Returning from the alternate screen re-seeds the split region from the
 *    renderer's alt-screen cursor, which overwrites the rows above the
 *    footer. The pre-switch surface offset is restored as the seed instead.
 */
export class InlineScreen {
  private savedOffset?: number
  private pageActive = false

  constructor(private readonly renderer: CliRenderer) {}

  get onPage(): boolean {
    return this.pageActive
  }

  /** Request a footer height; returns the height actually applied. */
  setFooterHeight(requested: number, allowGrowth = false): number {
    const renderer = this.renderer
    if (this.pageActive || renderer.isDestroyed) return renderer.footerHeight
    const rows = Math.max(1, renderer.terminalHeight)
    const target = Math.max(1, Math.min(rows, Math.round(requested)))
    const current = renderer.footerHeight
    if (target === current) return current
    if (target < current || allowGrowth) {
      renderer.footerHeight = target
      return target
    }
    const room = rows - internals(renderer).renderOffset
    const applied = Math.max(current, Math.min(target, room))
    if (applied !== current) renderer.footerHeight = applied
    return applied
  }

  enterPage(): void {
    if (this.pageActive) return
    const renderer = this.renderer
    this.savedOffset = internals(renderer).renderOffset
    renderer.externalOutputMode = 'passthrough'
    renderer.screenMode = 'alternate-screen'
    renderer.useMouse = true
    this.pageActive = true
  }

  leavePage(mouse: boolean): void {
    if (!this.pageActive) return
    const renderer = this.renderer
    const split = internals(renderer)
    this.pageActive = false
    renderer.useMouse = mouse
    renderer.screenMode = 'split-footer'
    const offset = Math.min(this.savedOffset ?? 0, Math.max(renderer.terminalHeight - renderer.footerHeight, 0))
    const seed = split.getSplitCursorSeedRows
    split.getSplitCursorSeedRows = () => offset
    split.renderOffset = offset
    try {
      renderer.externalOutputMode = 'capture-stdout'
    } finally {
      split.getSplitCursorSeedRows = seed
    }
    renderer.requestRender()
  }
}

export function createTerminalPort(renderer: CliRenderer, screen: InlineScreen, onResume: () => void): TerminalPort {
  return {
    setTitle: (title) => renderer.setTerminalTitle(title),
    copyToClipboard: (text) => renderer.copyToClipboardOSC52(text),
    setMouseEnabled: (enabled) => {
      if (!screen.onPage) renderer.useMouse = enabled
    },
    suspend: async (work) => {
      await renderer.idle().catch(() => undefined)
      await renderer.suspend()
      try {
        return await work()
      } finally {
        if (!renderer.isDestroyed) {
          await renderer.resume()
          onResume()
        }
      }
    },
    clearScreen: () => {
      if (!screen.onPage) renderer.resetSplitFooterForReplay({ clearSavedLines: false })
    },
    repaint: () => {
      internals(renderer).forceFullRepaintRequested = true
      renderer.requestRender()
    },
    size: () => ({ width: renderer.terminalWidth, height: renderer.terminalHeight }),
    suspendProcess: () => {
      void renderer.suspend().then(() => {
        process.once('SIGCONT', () => {
          if (!renderer.isDestroyed) void renderer.resume().then(onResume)
        })
        process.kill(0, 'SIGTSTP')
      })
    }
  }
}
