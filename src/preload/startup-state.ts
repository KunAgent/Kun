import { ipcRenderer } from 'electron'
import type {
  DesktopStartupPhase,
  DesktopStartupStatePayload
} from '../shared/desktop-startup-state'

export type DesktopStartupPreloadApi = {
  getState: () => Promise<DesktopStartupStatePayload>
  onState: (handler: (payload: DesktopStartupStatePayload) => void) => () => void
}

function normalizeStatePayload(payload: unknown): DesktopStartupStatePayload {
  if (payload && typeof payload === 'object' && 'phase' in payload) {
    const candidate = payload as { phase?: unknown; detail?: unknown }
    if (typeof candidate.phase === 'string') {
      return typeof candidate.detail === 'string'
        ? { phase: candidate.phase as DesktopStartupPhase, detail: candidate.detail }
        : { phase: candidate.phase as DesktopStartupPhase }
    }
  }
  // Older main processes (or transitional handoffs) may still publish a bare
  // phase string; accept it without a detail.
  if (typeof payload === 'string') return { phase: payload as DesktopStartupPhase }
  return { phase: 'bootstrapping' }
}

export function createDesktopStartupPreloadApi(): DesktopStartupPreloadApi {
  return {
    getState: async () => normalizeStatePayload(await ipcRenderer.invoke('startup:state:get')),
    onState: (handler) => {
      const wrapped = (
        _: Electron.IpcRendererEvent,
        payload: Parameters<typeof handler>[0] | DesktopStartupPhase
      ): void => handler(normalizeStatePayload(payload))
      ipcRenderer.on('startup:state', wrapped)
      return () => ipcRenderer.removeListener('startup:state', wrapped)
    }
  }
}
