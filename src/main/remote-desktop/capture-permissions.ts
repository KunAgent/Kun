type CapturePermissionDetails = {
  isMainFrame?: boolean
  mediaTypes?: readonly string[]
  mediaType?: string
}

/** Only used in the isolated, approved-display capture renderer's session. */
export function permitsDesktopCapture(permission: string, details: CapturePermissionDetails, phase: 'request' | 'check'): boolean {
  if (details.isMainFrame === false) return false
  if (permission === 'display-capture') return !details.mediaTypes?.includes('audio')
  if (permission !== 'media') return false
  // Electron 43.1 reports display requests as media + [], and display checks as
  // media + "unknown". Camera/microphone requests have nonempty mediaTypes.
  // https://github.com/electron/electron/blob/v43.1.0/shell/browser/web_contents_permission_helper.cc
  return phase === 'request'
    ? Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0
    : details.mediaType === 'unknown'
}

const CAPTURE_FAILURE_NAMES = new Set([
  'NotAllowedError', 'NotFoundError', 'NotReadableError', 'InvalidStateError',
  'AbortError', 'OverconstrainedError', 'SecurityError', 'TypeError'
])

/** Native/browser messages can contain device details. Retain only fixed error names. */
export function captureFailureName(value: unknown): string {
  return typeof value === 'string' && CAPTURE_FAILURE_NAMES.has(value) ? value : 'UnknownError'
}
