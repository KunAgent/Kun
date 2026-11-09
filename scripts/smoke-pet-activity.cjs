'use strict'
// Verifies the shipped helper without injecting keys or opening any audio device.
const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const path = require('node:path')
const helper = process.argv[2] || path.resolve(__dirname, '../resources/native/pet-activity')

async function exitsAfterInputEnds() {
  const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  let ready = false
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.stdout.once('data', () => { ready = true; child.stdin.end() })
      child.once('exit', (code) => { try { assert.equal(code, 0); resolve() } catch (error) { reject(error) } })
    })
    assert.ok(ready, 'helper must report its initial state')
  } finally { clearTimeout(timeout); child.kill() }
}

async function expiresWithoutHeartbeat() {
  const child = spawn(helper, [], { stdio: ['pipe', 'pipe', 'pipe'] })
  const started = Date.now()
  const timeout = setTimeout(() => child.kill('SIGKILL'), 19000)
  child.stdout.resume(); child.stderr.resume()
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => { try { assert.equal(code, 0); resolve() } catch (error) { reject(error) } })
    })
    assert.ok(Date.now() - started >= 14000, 'observer expired before its heartbeat deadline')
  } finally { clearTimeout(timeout); child.kill() }
}

async function main() {
  if (process.platform !== 'darwin') { console.log('SKIP: macOS pet activity helper'); return }
  const lines = (args) => execFileSync(helper, args, { encoding: 'utf8', timeout: 30000 }).trim().split('\n').map(JSON.parse)
  assert.deepEqual(lines(['--self-test']), [
    { type: 'status', keyboard: 'off', microphone: 'off' },
    ...[[1, 1], [1, 1], [3, 2], [3, 0], [2, 0], [0, 0], [3, 3], [0, 0]]
      .map(([held, tap], index) => ({ type: 'keys', sequence: index + 1, held, tap })),
    { type: 'recording', active: true }, { type: 'recording', active: false }
  ])
  const [status] = lines(['--status', '--keyboard', '--microphone'])
  assert.equal(status.type, 'status')
  assert.ok(['active', 'permission-required', 'unavailable'].includes(status.keyboard))
  assert.ok(['active', 'unsupported', 'unavailable'].includes(status.microphone))
  await exitsAfterInputEnds()
  await expiresWithoutHeartbeat()
  console.log(JSON.stringify({ ok: true, availability: status, checks: ['protocol', 'read-only OS probe', 'owner EOF', 'heartbeat expiry'] }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
