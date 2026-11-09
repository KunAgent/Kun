const assert = require('node:assert/strict')
const { spawn, execFileSync } = require('node:child_process')
const { resolve } = require('node:path')
const { once } = require('node:events')
const { test } = require('node:test')
const helper = resolve(__dirname, '../resources/native/remote-desktop-input')

test('native identity and termination refuse stale or unrelated identities without OS input', { skip: process.platform !== 'darwin' }, async () => {
  const child = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
  try {
    const birth = execFileSync(helper, ['--identity', String(child.pid)], { encoding: 'utf8' }).trim()
    assert.match(birth, /^\d+:\d+$/)
    assert.throws(() => execFileSync(helper, ['--terminate', String(child.pid), '0:0'], { stdio: 'ignore' }))
    assert.doesNotThrow(() => process.kill(child.pid, 0))
    const own = execFileSync(helper, ['--identity', String(process.pid)], { encoding: 'utf8' }).trim()
    assert.throws(() => execFileSync(helper, ['--terminate', String(process.pid), own], { stdio: 'ignore' }))
    const exited = once(child, 'exit')
    execFileSync(helper, ['--terminate', String(child.pid), birth], { stdio: 'ignore' })
    await exited
    assert.throws(() => process.kill(child.pid, 0))
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
})

test('release-only accepts an empty owned ledger and rejects arbitrary operations', { skip: process.platform !== 'darwin' }, () => {
  execFileSync(helper, ['--release-only'], { input: JSON.stringify({ keys: [], buttons: [] }) + '\n', stdio: ['pipe', 'ignore', 'ignore'] })
  assert.throws(() => execFileSync(helper, ['--release-only'], { input: '{"keys":[],"buttons":[],"command":"anything"}\n', stdio: ['pipe', 'ignore', 'ignore'] }))
})

test('an unrenewed native lease ends only its registered capture process without posting input', { skip: process.platform !== 'darwin', timeout: 5000 }, async () => {
  const capture = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
  const guard = spawn(helper, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  try {
    const birth = execFileSync(helper, ['--identity', String(capture.pid)], { encoding: 'utf8' }).trim()
    let buffer = ''
    guard.stdout.setEncoding('utf8')
    const configured = new Promise((resolve, reject) => {
      guard.stdout.on('data', chunk => {
        buffer += chunk
        if (buffer.includes('\n')) {
          const response = JSON.parse(buffer.split('\n')[0])
          if (response.ok) resolve(); else reject(new Error(response.error))
        }
      })
    })
    guard.stdin.write(JSON.stringify({ id: 1, operation: 'configure', displayId: 0, capturePid: capture.pid, captureBirth: birth }) + '\n')
    await configured
    const ended = Promise.all([once(capture, 'exit'), once(guard, 'exit')])
    guard.stdin.write(JSON.stringify({ id: 2, operation: 'lease', remainingMs: 10 }) + '\n')
    await ended
    assert.throws(() => process.kill(capture.pid, 0))
  } finally {
    guard.stdin.destroy()
    if (guard.exitCode === null && guard.signalCode === null) guard.kill('SIGKILL')
    if (capture.exitCode === null && capture.signalCode === null) capture.kill('SIGKILL')
  }
})

test('setup lease honors a shorter authorization deadline without OS input', { skip: process.platform !== 'darwin', timeout: 5000 }, async () => {
  const capture = spawn('/bin/sleep', ['30'], { stdio: 'ignore' })
  const guard = spawn(helper, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  try {
    const birth = execFileSync(helper, ['--identity', String(capture.pid)], { encoding: 'utf8' }).trim()
    const ended = Promise.all([once(capture, 'exit'), once(guard, 'exit')])
    guard.stdin.write(JSON.stringify({ id: 1, operation: 'configure', displayId: 0, capturePid: capture.pid, captureBirth: birth }) + '\n')
    guard.stdin.write(JSON.stringify({ id: 2, operation: 'setupLease', remainingMs: 10 }) + '\n')
    await ended
    assert.throws(() => process.kill(capture.pid, 0))
  } finally {
    guard.stdin.destroy()
    if (guard.exitCode === null && guard.signalCode === null) guard.kill('SIGKILL')
    if (capture.exitCode === null && capture.signalCode === null) capture.kill('SIGKILL')
  }
})

test('setup cannot extend an active native lease back to negotiation duration', { skip: process.platform !== 'darwin', timeout: 5000 }, async () => {
  const guard = spawn(helper, [], { stdio: ['pipe', 'pipe', 'ignore'] })
  try {
    let buffer = ''
    const responses = new Promise((resolve, reject) => {
      guard.stdout.setEncoding('utf8')
      guard.stdout.on('data', chunk => {
        buffer += chunk
        const lines = buffer.trim().split('\n')
        if (lines.length >= 2) {
          try { resolve(lines.slice(0, 2).map(JSON.parse)) } catch (error) { reject(error) }
        }
      })
    })
    guard.stdin.write(JSON.stringify({ id: 1, operation: 'lease', remainingMs: 1000 }) + '\n')
    guard.stdin.write(JSON.stringify({ id: 2, operation: 'setupLease', remainingMs: 15000 }) + '\n')
    assert.deepEqual(await responses, [{ id: 1, ok: true }, { id: 2, error: 'INVALID_REQUEST' }])
    const ended = once(guard, 'exit')
    guard.stdin.end(JSON.stringify({ id: 3, operation: 'stop' }) + '\n')
    await ended
  } finally {
    guard.stdin.destroy()
    if (guard.exitCode === null && guard.signalCode === null) guard.kill('SIGKILL')
  }
})
