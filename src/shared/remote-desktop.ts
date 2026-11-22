export { DESKTOP_CAPTURE_CHANNELS } from './desktop-capture-channels'
export type DesktopDisplay = { token: string; revision: string; label: string; pixelWidth: number; pixelHeight: number; rotation: number }
export type DesktopAccessStatus = {
  supported: boolean
  enabled: boolean
  ready: boolean
  /** OS permission, independent of sharing enablement and selected displays. */
  screenRecordingReady?: boolean
  inputReady?: boolean
  gameSupported?: boolean
  gameEnabled?: boolean
  systemAudioEnabled?: boolean
  virtualSupported?: boolean
  virtualEnabled?: boolean
  reason?: string
  lastFailure?: string
  displays: Array<DesktopDisplay & { allowed: boolean }>
  active?: { sessionId: string; peer: string; mode: 'view' | 'control' }
}
export type DesktopConfiguration = { enabled: boolean; displayTokens: string[]; allowVirtual?: boolean; allowGame?: boolean; allowSystemAudio?: boolean }
export type CaptureCommand = { id: string; operation: 'start' | 'answer' | 'ice' | 'stop' | 'send' | 'quality'; params: Record<string, unknown> }
export type CaptureReply = { id: string; value?: unknown; error?: string }
export type CaptureEvent = { event: 'ice' | 'data' | 'closed' | 'ready' | 'health'; value?: unknown }
export type NativeCaptureSample = { kind: 'audio' | 'video'; data: Uint8Array; width?: number; height?: number }
export type DesktopCaptureBridge = { onSample?(listener: (sample: NativeCaptureSample) => void): () => void; onCommand(listener: (command: CaptureCommand) => void): () => void; reply(value: CaptureReply): void; event(value: CaptureEvent): void }
