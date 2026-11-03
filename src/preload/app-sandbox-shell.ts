import { ipcRenderer } from 'electron'

// Sandboxed preloads can only require 'electron': importing a module shared
// with the workbench preload would make Rollup emit a common chunk that this
// preload cannot load. Keep these literals in sync with src/shared/app-sandbox.ts
// (pinned by app-sandbox-shell.test.ts).
const SHELL_CHANNELS = {
  guestHello: 'app-sandbox:guest-hello',
  guestMessage: 'app-sandbox:guest-message',
  hostMessage: 'app-sandbox:host-message'
} as const
const SHELL_INSTANCE_ARGUMENT = '--kun-app-sandbox-instance='
const SHELL_NONCE_ARGUMENT = '--kun-app-sandbox-nonce='

/**
 * Preload for the Kun-owned shell document of an app sandbox webview. It
 * exposes nothing to any page. It only relays raw messages between the
 * framed guest page (a different origin) and Electron Main, which forwards
 * them to the workbench renderer that owns this instance.
 */
const instanceId =
  process.argv.find((argument) => argument.startsWith(SHELL_INSTANCE_ARGUMENT))
    ?.slice(SHELL_INSTANCE_ARGUMENT.length) ?? ''
const nonce =
  process.argv.find((argument) => argument.startsWith(SHELL_NONCE_ARGUMENT))
    ?.slice(SHELL_NONCE_ARGUMENT.length) ?? ''

function guestFrame(): HTMLIFrameElement | null {
  const element = document.getElementById('kun-app-guest')
  return element instanceof HTMLIFrameElement ? element : null
}

function guestOrigin(frame: HTMLIFrameElement): string | null {
  try {
    const url = new URL(frame.src)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

if (instanceId && nonce) {
  ipcRenderer.send(SHELL_CHANNELS.guestHello, { instanceId, nonce })

  window.addEventListener('message', (event: MessageEvent) => {
    const frame = guestFrame()
    if (!frame) return
    const origin = guestOrigin(frame)
    if (!origin || event.origin !== origin || event.source === window) return
    ipcRenderer.send(SHELL_CHANNELS.guestMessage, { instanceId, message: event.data })
  })

  ipcRenderer.on(SHELL_CHANNELS.hostMessage, (_event, payload: { instanceId?: unknown; message?: unknown }) => {
    if (payload?.instanceId !== instanceId) return
    const frame = guestFrame()
    const origin = frame ? guestOrigin(frame) : null
    if (!frame?.contentWindow || !origin) return
    frame.contentWindow.postMessage(payload.message, origin)
  })
}
