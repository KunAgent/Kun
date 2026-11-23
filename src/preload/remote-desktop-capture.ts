import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopCaptureBridge, NativeCaptureSample, CaptureCommand } from '../shared/remote-desktop'
import { DESKTOP_CAPTURE_CHANNELS as channels } from '../shared/desktop-capture-channels'
const bridge: DesktopCaptureBridge = {
  onSample(listener) {
    const receive = (_event: Electron.IpcRendererEvent, value: NativeCaptureSample) => {
      try { listener(value) } finally { ipcRenderer.send(channels.consumed, value.kind) }
    }
    ipcRenderer.on(channels.sample, receive)
    return () => ipcRenderer.removeListener(channels.sample, receive)
  },
  onCommand(listener) {
    const receive = (_event: Electron.IpcRendererEvent, command: CaptureCommand) => listener(command)
    ipcRenderer.on(channels.request, receive)
    return () => ipcRenderer.removeListener(channels.request, receive)
  },
  reply: value => ipcRenderer.send(channels.response, value),
  event: value => ipcRenderer.send(channels.event, value)
}
contextBridge.exposeInMainWorld('kunDesktopCapture', bridge)
