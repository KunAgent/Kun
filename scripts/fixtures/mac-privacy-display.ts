import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { setTimeout as wait } from 'node:timers/promises'
import { app, BrowserWindow, screen } from 'electron'
import { desktopHelperPath } from '../../src/main/remote-desktop/native-input'

/** All pixel reads and curtains are additionally restricted to the synthetic display by the native fixture. */
export async function createPrivacyDisplay() {
  app.dock?.hide()
  const helper = desktopHelperPath()
  const display = spawn(helper, ['--virtual-display'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: display.stdout })[Symbol.asyncIterator]()
  const closed = new Promise<void>(resolve => display.once('close', () => resolve()))
  display.stdin.write('size 900 600\n')
  const id = Number(/^owned (\d+)$/.exec((await lines.next()).value ?? '')?.[1])
  assert.ok(id && /^screen /.test((await lines.next()).value ?? ''))
  for (let n = 0; n < 50 && !screen.getAllDisplays().some(s => s.id === id); n++) await wait(50)
  const target = screen.getAllDisplays().find(s => s.id === id)
  assert.ok(target && id !== screen.getPrimaryDisplay().id)
  const window = new BrowserWindow({ ...target.bounds, show: false, frame: false, focusable: false,
    backgroundColor: '#ef3020', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await window.loadURL('data:text/html,<body style="background:rgb(240,40,30)"><div style="width:10px;height:10px;background:blue;animation:pulse .3s infinite alternate"></div><style>@keyframes pulse{to{opacity:0.1}}</style>')
  window.setBounds(target.bounds); window.showInactive()
  assert.equal(screen.getDisplayMatching(window.getBounds()).id, id)
  const probe = spawn(join(app.getAppPath(), 'PixelProbe.app/Contents/MacOS/PixelProbe'), ['--pixel', String(id)], { stdio: ['pipe', 'pipe', 'inherit'] })
  const samples = createInterface({ input: probe.stdout })[Symbol.asyncIterator]()
  async function color() {
    probe.stdin.write('pixel\n')
    const sample = await samples.next()
    assert.ok(!sample.done, 'Synthetic display probe exited')
    return sample.value.trim().split(' ').map(Number)
  }
  async function requireColor(kind: 'red' | 'green' | 'black') {
    let last: number[] = []
    for (let i = 0; i < 12; i++) {
      last = await color()
      const [r,g,b] = last
      if (kind === 'black' ? Math.max(r,g,b) < 20 : kind === 'green' ? g > r+70 && g > b+70 : r > g+70 && r > b+70) return
      await wait(75)
    }
    throw Error('Expected ' + kind + ' on the synthetic monitor, got ' + last)
  }
  await requireColor('red')
  return { id, requireColor, green: () => window.webContents.executeJavaScript("document.body.style.background='rgb(35,225,65)'"),
    async stop() { probe.stdin.end(); if (!window.isDestroyed()) window.destroy(); display.stdin.end(); await closed } }
}
