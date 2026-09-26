import type { MobileMode } from './navigation/mobile-page'

export type WorkLeaveState = {
  saveStatus: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  conflict: boolean
  reviewActive: boolean
}
export type WorkLeaveDecision = 'allow' | 'save' | 'wait' | 'confirm-discard' | 'resolve-conflict'

/** Pure policy only. The caller must perform save/discard/resolve actions in the existing Work store. */
export function workLeaveDecision(state: WorkLeaveState): WorkLeaveDecision {
  if (state.conflict) return 'resolve-conflict'
  if (state.reviewActive) return 'confirm-discard'
  if (state.saveStatus === 'saving') return 'wait'
  if (state.saveStatus === 'dirty') return 'save'
  if (state.saveStatus === 'error') return 'confirm-discard'
  return 'allow'
}

export function modeForWorkbenchRoute(route: string): MobileMode {
  if (route === 'rooms') return 'rooms'
  if (route === 'write') return 'work'
  return 'code'
}

export function workbenchRouteForMode(mode: MobileMode): 'chat' | 'rooms' | 'write' {
  if (mode === 'rooms') return 'rooms'
  if (mode === 'work') return 'write'
  return 'chat'
}
