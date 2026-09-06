import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { isMiniWindowMode, toggleMiniWindowMode } from '../../src/main/window-mini-mode'

const userData = process.env.KUN_MINI_SMOKE_USER_DATA
const appData = process.env.KUN_MINI_SMOKE_APP_DATA
if (!userData || !appData) throw new Error('Isolated mini-window smoke paths are required')
app.setPath('appData', appData)
app.setPath('userData', userData)
app.setName('Kun Mini Window Smoke')

void app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280, height: 840, minWidth: 960, minHeight: 640,
    titleBarStyle: 'hidden', show: true,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  })
  ipcMain.handle('mini-state', () => ({
    mini: isMiniWindowMode(window), maximized: window.isMaximized(),
    bounds: window.getBounds(), minimumSize: window.getMinimumSize(),
    alwaysOnTop: window.isAlwaysOnTop()
  }))
  ipcMain.handle('mini-command', (_event, command: string) => {
    if (command === 'toggleMini') {
      const mini = toggleMiniWindowMode(window)
      window.webContents.send('mini-state-changed', mini)
    } else if (command === 'maximize') window.maximize()
    else throw new Error(`Unsupported smoke command: ${command}`)
  })
  await window.loadFile(join(__dirname, 'index.html'))
})
app.on('window-all-closed', () => app.quit())
