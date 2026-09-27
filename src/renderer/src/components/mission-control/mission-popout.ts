/**
 * Mission Control popout marker (docs/ade/impl P2-09): the auxiliary
 * BrowserWindow loads the same workbench bundle with `?popout=1`. Inside
 * that window the board renders standalone — card activation is forwarded
 * to the main window instead of driving local chat state.
 */
export function isMissionControlPopout(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return new URLSearchParams(window.location.search).get('popout') === '1'
  } catch {
    return false
  }
}

/** Popout is a desktop-only surface; remote-web clients never see the control. */
export function canPopoutMissionControl(): boolean {
  if (typeof window === 'undefined' || isMissionControlPopout()) return false
  const bridge = window.kunGui
  return typeof bridge?.missionControlTogglePopout === 'function' && bridge.isRemoteWeb !== true
}

export function toggleMissionControlPopout(): void {
  if (typeof window === 'undefined') return
  const bridge = window.kunGui
  if (typeof bridge?.missionControlTogglePopout === 'function') {
    void bridge.missionControlTogglePopout().catch(() => undefined)
  }
}

/** Open the card's thread in the main workbench window. */
export function openMissionControlThread(threadId: string): void {
  if (typeof window === 'undefined') return
  const bridge = window.kunGui
  if (typeof bridge?.missionControlOpenThread === 'function') {
    void bridge.missionControlOpenThread(threadId).catch(() => undefined)
  }
}
