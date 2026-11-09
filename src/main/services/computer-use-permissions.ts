import { desktopCapturer, shell, systemPreferences } from 'electron'

export type ComputerUsePermissionState = 'granted' | 'denied' | 'unknown'

export type ComputerUsePermissions = {
  platform: NodeJS.Platform
  /** Whether the host backend can run on this platform at all. */
  supported: boolean
  /** Whether the OS gates input/capture behind a permission prompt (macOS). */
  needsPermission: boolean
  /** Accessibility permission (controls mouse/keyboard injection on macOS). */
  accessibility: ComputerUsePermissionState
  /** Screen Recording permission (controls screenshots on macOS). */
  screenRecording: ComputerUsePermissionState
  /**
   * macOS only: a secondary native trust check reports a grant while Electron
   * still reports untrusted. This is a best-effort relaunch hint, not a direct
   * reading of the permission toggle in System Settings.
   */
  accessibilityNeedsRestart: boolean
}

/**
 * The native macOS permission helper bundled with @computer-use/nut-js.
 * Use its screen capture request to register the app with TCC. Its
 * Accessibility helper checks trust without prompting, so use Electron's
 * explicit prompt instead for that permission.
 */
type MacPermissions = {
  getAuthStatus(type: 'accessibility' | 'screen'): string
  askForScreenCaptureAccess(): unknown
}

let macPermissions: Promise<MacPermissions | null> | undefined

async function loadMacPermissions(): Promise<MacPermissions | null> {
  macPermissions ??= (async () => {
    try {
      // node-mac-permissions is a transitive native dep (a .node addon), so it
      // is NOT externalized by electron-vite's direct-deps plugin. Load it via
      // a variable specifier + @vite-ignore so Rollup leaves it as a runtime
      // import instead of trying (and failing) to bundle the native binary.
      const specifier = '@computer-use/node-mac-permissions'
      const ns = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>
      return ((ns as { default?: unknown }).default ?? ns) as MacPermissions
    } catch {
      return null
    }
  })()
  return macPermissions
}

function normalizeState(status: string | undefined): ComputerUsePermissionState {
  if (status === 'authorized' || status === 'granted') return 'granted'
  if (status === 'unknown' || status === 'not determined' || status === 'not-determined' || status === undefined) return 'unknown'
  return 'denied'
}

/**
 * Report the host-control OS permission status. On macOS, computer-use
 * needs Accessibility (input injection) and Screen Recording (capture);
 * on Windows/Linux no special permission gate applies. Checks are
 * read-only — they never trigger a system prompt.
 */
export async function getComputerUsePermissions(): Promise<ComputerUsePermissions> {
  const platform = process.platform
  if (platform !== 'darwin') {
    return {
      platform,
      supported: true,
      needsPermission: false,
      accessibility: 'granted',
      screenRecording: 'granted',
      accessibilityNeedsRestart: false
    }
  }
  // Live trust: whether THIS process can inject right now.
  let liveTrust = false
  try {
    liveTrust = systemPreferences.isTrustedAccessibilityClient(false)
  } catch {
    liveTrust = false
  }
  // This helper also uses AXIsProcessTrusted, not the TCC database. Neither
  // check proves what System Settings shows if macOS requires a relaunch.
  let nativeAccessibilityGranted = false
  try {
    const native = await loadMacPermissions()
    nativeAccessibilityGranted = native?.getAuthStatus('accessibility') === 'authorized'
  } catch {
    nativeAccessibilityGranted = false
  }
  let screenRecording: ComputerUsePermissionState = 'unknown'
  try {
    screenRecording = normalizeState(systemPreferences.getMediaAccessStatus('screen'))
  } catch {
    screenRecording = 'unknown'
  }
  return {
    platform,
    supported: true,
    needsPermission: true,
    accessibility: liveTrust ? 'granted' : 'denied',
    screenRecording,
    accessibilityNeedsRestart: !liveTrust && nativeAccessibilityGranted
  }
}

/**
 * Proactively enroll Kun in the relevant macOS permission list and open
 * the settings pane. Registration failures still open the appropriate pane;
 * failures to open settings propagate to the UI. Returns the current process
 * status, which can remain ungranted until the user allows access or relaunches.
 */
export async function requestComputerUsePermission(
  kind: 'accessibility' | 'screenRecording'
): Promise<ComputerUsePermissions> {
  if (process.platform !== 'darwin') return getComputerUsePermissions()
  if (kind === 'accessibility') {
    try {
      systemPreferences.isTrustedAccessibilityClient(true)
    } catch {
      // Still open settings so the user can enable permission there.
    }
  } else {
    let requested = false
    try {
      const native = await loadMacPermissions()
      if (native?.askForScreenCaptureAccess) {
        await native.askForScreenCaptureAccess()
        requested = true
      }
    } catch {
      // A broken native module must still fall back to Electron capture.
    }
    if (!requested) {
      try {
        await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
      } catch {
        // Capture can fail before permission is allowed. Still open settings.
      }
    }
  }
  const pane = kind === 'accessibility' ? 'Privacy_Accessibility' : 'Privacy_ScreenCapture'
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  return getComputerUsePermissions()
}
