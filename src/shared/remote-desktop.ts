export { DESKTOP_CAPTURE_CHANNELS } from './desktop-capture-channels'
export { DESKTOP_INDICATOR_CHANNEL } from './desktop-indicator-channels'
export type DesktopDisplay = { token: string; revision: string; label: string; pixelWidth: number; pixelHeight: number; rotation: number }
export type DesktopAccessStatus = {
  supported: boolean
  enabled: boolean
  ready: boolean
  /** OS permission, independent of sharing enablement and selected displays. */
  screenRecordingReady?: boolean
  inputReady?: boolean
  reason?: string
  lastFailure?: string
  displays: Array<DesktopDisplay & { allowed: boolean }>
  active?: { sessionId: string; peer: string; mode: 'view' | 'control' }
}
export type DesktopConfiguration = { enabled: boolean; displayTokens: string[] }
export type CaptureCommand = { id: string; operation: 'start' | 'answer' | 'ice' | 'stop' | 'send' | 'quality'; params: Record<string, unknown> }
export type CaptureReply = { id: string; value?: unknown; error?: string }
export type CaptureEvent = { event: 'ice' | 'data' | 'closed' | 'ready' | 'health'; value?: unknown }
export type DesktopCaptureBridge = { onCommand(listener: (command: CaptureCommand) => void): () => void; reply(value: CaptureReply): void; event(value: CaptureEvent): void }
