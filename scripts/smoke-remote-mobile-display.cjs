// Exercise WindowServer and Electron display discovery. No capture or input permissions are used.
const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { createInterface } = require('node:readline')
const { setTimeout: delay } = require('node:timers/promises')

async function run(app, screen) {
  const before = screen.getAllDisplays().map(d => ({ id: d.id, size: d.size, scale: d.scaleFactor }))
  const helper = resolve(__dirname, '../resources/native/remote-desktop-input')
  const child = spawn(helper, ['--virtual-display'], { stdio: ['pipe', 'pipe', 'inherit'] })
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const exit = new Promise((done, fail) => { child.once('error', fail); child.once('exit', done) })
  const timeout = setTimeout(() => child.kill('SIGKILL'), 35000)
  let id
  const results = []
  async function until(check) {
    for (let i = 0; i < 70; i++) { if (check()) return; await delay(75) }
    throw Error('WindowServer did not confirm the display geometry')
  }
  try {
    for (const [width, height] of [[1024, 768], [390, 844], [777, 611], [1280, 720], [900, 1440]]) {
      child.stdin.write(`size ${width} ${height}\n`)
      if (!id) {
        const line = (await lines.next()).value
        assert.match(line, /^owned \d+$/); id = Number(line.split(' ')[1])
        assert.ok(id > 0 && !before.some(d => d.id === id))
      }
      const line = (await lines.next()).value
      if (line === undefined) throw Error(`Mobile display helper exited with code ${await exit} while applying ${width} × ${height}`)
      assert.match(line, /^screen \d+ \d+ \d+ \d+ \d+$/)
      const [reported, w, h, pw, ph] = line.split(' ').slice(1).map(Number)
      assert.equal(reported, id); assert.ok(Math.abs(w / h / (width / height) - 1) < 0.005)
      await until(() => {
        const d = screen.getAllDisplays().find(display => display.id === id)
        return d?.size.width === w && d.size.height === h && Math.round(w * d.scaleFactor) === pw && Math.round(h * d.scaleFactor) === ph
      })
      results.push({ requested: [width, height], logical: [w, h], pixels: [pw, ph] })
    }
  } finally { child.stdin.end(); try { await exit } finally { clearTimeout(timeout) } }
  await until(() => !screen.getAllDisplays().some(d => d.id === id))
  assert.deepEqual(screen.getAllDisplays().map(d => ({ id: d.id, size: d.size, scale: d.scaleFactor })), before)
  console.log(JSON.stringify({ oneDisplay: id, results, removed: true, physicalDisplaysUnchanged: true }))
}
if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', timeout: 45000 })
  if (child.error) throw child.error
  process.exitCode = child.status ?? 1
} else {
  const { app, screen } = require('electron')
  const temp = mkdtempSync(join(tmpdir(), 'kun-mobile-display-'))
  app.setPath('userData', temp); app.dock?.hide()
  app.whenReady().then(() => run(app, screen)).then(() => app.exit(0), error => { console.error(error); app.exit(1) })
  app.once('will-quit', () => rmSync(temp, { recursive: true, force: true }))
}
