import { contextBridge, ipcRenderer } from 'electron'
import type { ComputerViewerBridge } from '@kun/control-runtime/viewer'

const unavailable = async (): Promise<never> => { throw Error('CONTROL_PROBE_HAS_NO_AUTHORITY') }
const bridge: ComputerViewerBridge = {
  configuration: async () => ({ mode: 'probe' }),
  // Keep this one channel literal local: a shared import creates a CommonJS chunk
  // that Electron's sandboxed preload loader cannot require.
  ready: api => ipcRenderer.send('computer-viewer:ready', api),
  invoke: unavailable, ice: unavailable, restart: unavailable, close: unavailable, fullscreen: unavailable,
  heartbeat: () => {}, onEvent: () => () => {}
}
contextBridge.exposeInMainWorld('kunComputerViewer', bridge)
