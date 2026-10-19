import { createCliRenderer, type CliRenderer, type CliRendererConfig } from '@opentui/core'
import type { TerminalPort } from '../session/session-types.js'

/** Fields of CliRenderer this module touches that are not public API. */
type RepaintInternals = {
  forceFullRepaintRequested?: boolean
}

export type RendererStreams = {
  stdin?: NodeJS.ReadStream
  stdout?: NodeJS.WriteStream
}

export async function createKunRenderer(streams: RendererStreams = {}): Promise<CliRenderer> {
  const config: CliRendererConfig = {
    ...(streams.stdin ? { stdin: streams.stdin } : {}),
    ...(streams.stdout ? { stdout: streams.stdout } : {}),
    // Kun owns the whole screen: the conversation scrolls inside the app and
    // the terminal's own screen is restored untouched on exit.
    screenMode: 'alternate-screen',
    externalOutputMode: 'passthrough',
    consoleMode: 'disabled',
    openConsoleOnError: false,
    exitOnCtrlC: false,
    exitSignals: [],
    useMouse: true,
    autoFocus: false,
    targetFps: 30,
    maxFps: 60,
    useKittyKeyboard: {}
  }
  return createCliRenderer(config)
}

export function createTerminalPort(renderer: CliRenderer, onResume: () => void): TerminalPort {
  return {
    setTitle: (title) => renderer.setTerminalTitle(title),
    copyToClipboard: (text) => renderer.copyToClipboardOSC52(text),
    setMouseEnabled: (enabled) => {
      renderer.useMouse = enabled
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
    repaint: () => {
      ;(renderer as unknown as RepaintInternals).forceFullRepaintRequested = true
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
