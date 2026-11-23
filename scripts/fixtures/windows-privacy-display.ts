import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'
import { app, BrowserWindow, screen } from 'electron'

/** Only called on an explicitly disposable single-monitor Windows desktop. */
export async function createWindowsPrivacyDisplay() {
  assert.equal(process.env.KUN_FIXTURE_DISPOSABLE_WINDOWS, '1')
  const monitors = screen.getAllDisplays()
  assert.equal(monitors.length, 1, 'Use a dedicated single-monitor Windows test desktop')
  const target = monitors[0]
  const window = new BrowserWindow({ ...target.bounds, show: false, frame: false, thickFrame: false,
    skipTaskbar: true, focusable: false, backgroundColor: '#ef3020',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  const html = '<body style="background:rgb(240,40,30)"><div style="width:10px;height:10px;background:blue;animation:pulse .3s infinite alternate"></div><style>@keyframes pulse{to{opacity:0.1}}</style>'
  const inspector = join(app.getAppPath(), 'privacy-windows-test.exe')
  async function requireColor(kind: 'red' | 'green' | 'black') {
    let failure: unknown
    for (let i = 0; i < 10; i++) {
      try {
        await promisify(execFile)(inspector, ['-test.run=^TestObservePhonePrivacy$'], {
          windowsHide: true, timeout: 3000, env: { ...process.env,
            KUN_TEST_PRIVACY_HWND: window.getNativeWindowHandle().readBigUInt64LE().toString(16),
            KUN_TEST_PRIVACY_OPAQUE: kind === 'black' ? '1' : '0' }
        })
        if (kind !== 'black') {
          const [w,h] = window.getContentSize()
          const sample = await window.webContents.capturePage({ x: Math.floor(w/2), y: Math.floor(h/2), width: 1, height: 1 })
          const [b,g,r] = sample.toBitmap()
          assert.ok(kind === 'green' ? g > r+70 && g > b+70 : r > g+70 && r > b+70)
        }
        return
      } catch (error) { failure = error; await wait(80) }
    }
    throw failure
  }
  try {
    await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    window.setAlwaysOnTop(true, 'screen-saver')
    window.setBounds(target.bounds); window.showInactive()
    await requireColor('red')
    return { id: target.id, requireColor, green: () => window.webContents.executeJavaScript("document.body.style.background='rgb(35,225,65)'"),
      async stop() { if (!window.isDestroyed()) window.destroy() } }
  } catch (error) { window.destroy(); throw error }
}
