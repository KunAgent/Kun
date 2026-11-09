import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopCaptureBridge, CaptureCommand } from '../shared/remote-desktop'
import { DESKTOP_CAPTURE_CHANNELS as channels } from '../shared/desktop-capture-channels'
const bridge: DesktopCaptureBridge = {
  onCommand(listener) {
    const receive = (_event: Electron.IpcRendererEvent, command: CaptureCommand) => listener(command)
    ipcRenderer.on(channels.request, receive)
    return () => ipcRenderer.removeListener(channels.request, receive)
  },
  reply: value => ipcRenderer.send(channels.response, value),
  event: value => ipcRenderer.send(channels.event, value)
}
contextBridge.exposeInMainWorld('kunDesktopCapture', bridge)
