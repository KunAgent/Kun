const assert = require('node:assert/strict')
const { test } = require('node:test')
const { spawn, execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { resolve } = require('node:path')

const name = process.platform === 'linux' ? 'linux-desktop/desktop_input.py' : process.platform === 'win32' ? 'remote-desktop-input.exe' : 'remote-desktop-input'
const binary = resolve(__dirname, '../resources/native', name)
const call = (...args) => execFileSync(binary, args, { timeout: 2500, windowsHide: true, encoding:'utf8', stdio:['pipe','pipe','pipe'] })

test('packaged helper only terminates a matching renderer owned by its parent', async () => {
  const fixture = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio:'ignore', windowsHide: true })
  const exit = once(fixture, 'exit')
  try {
    const pid = String(fixture.pid), identity = call('--identity', pid).trim()
    assert.match(identity, /^\d+:\d+$/)
    assert.throws(() => call('--terminate',pid,'0:0'))
    assert.throws(() => call('--terminate',String(process.pid),call('--identity',String(process.pid)).trim()))
    assert.doesNotThrow(() => process.kill(fixture.pid,0))
    call('--terminate',pid,identity)
    await exit
    execFileSync(binary, ['--release-only'], {input:'{"keys":[],"buttons":[]}\n',timeout:2500,windowsHide:true})
  } finally { fixture.kill() }
})
