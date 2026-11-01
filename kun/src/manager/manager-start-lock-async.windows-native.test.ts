import { fork, spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { windowsStartupNative, windowsStartupDirectory, type WindowsAsyncStartupLock } from '../process/windows-startup-native.js'

const children: ChildProcess[] = []
const roots: string[] = []
const held: WindowsAsyncStartupLock[] = []
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
afterEach(async () => {
  for (const lock of held.splice(0)) await windowsStartupNative().releaseStartLock(lock.handle, true)
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited
    }
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function path() {
  const root = await mkdtemp(join(tmpdir(), 'kun-native-lock-'))
  roots.push(root)
  return join(root, '.manager-start.lock')
}
function legacy(path: string, mode = 'owner', text = '') {
  const child = fork(join(import.meta.dirname, 'fixtures/legacy-start-lock.cjs'), [path, mode, text], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  children.push(child)
  return child
}
async function acquire(path: string) {
  const until = performance.now() + 5_000
  for (;;) {
    const lock = await windowsStartupNative().acquireStartLock(path)
    if (lock) { held.push(lock); return lock }
    if (performance.now() >= until) throw new Error('Native lock did not release')
    await pause(20)
  }
}
async function release(lock: WindowsAsyncStartupLock) {
  held.splice(held.indexOf(lock), 1)
  await windowsStartupNative().releaseStartLock(lock.handle, true)
}

describe.skipIf(process.platform !== 'win32')('Windows mixed-version startup locking', () => {
  it('never rewrites a hard-linked business file as startup metadata', async () => {
    const lockPath = await path()
    const history = lockPath + '.history-fixture'
    await writeFile(history, '{"saved":"conversation"}')
    await link(history, lockPath)
    await expect(windowsStartupNative().acquireStartLock(lockPath)).rejects.toMatchObject({ code: 'EACCES' })
    expect(await readFile(history, 'utf8')).toBe('{"saved":"conversation"}')
  })
  it('releases the guard after an inaccessible metadata path without entering a critical section', async () => {
    const lockPath = await path()
    await mkdir(lockPath)
    await expect(windowsStartupNative().acquireStartLock(lockPath)).rejects.toMatchObject({ code: 'EACCES' })
    await rm(lockPath, { recursive: true })
    await release(await acquire(lockPath))
  })
  it.each(['owner', 'empty'])('waits for an old %s wx holder, including unpublished metadata', async (mode) => {
    const lockPath = await path()
    const child = legacy(lockPath, mode)
    expect((await once(child, 'message'))[0]).toBe('entered')
    expect(await windowsStartupNative().acquireStartLock(lockPath)).toBeNull()
    const exited = once(child, 'exit'); child.kill(); await exited
    const lock = await acquire(lockPath)
    expect(lock.created).toBe(false)
    await release(lock)
  })

  it('keeps a live native holder safe from a delayed old compare/unlink reclaimer', async () => {
    const lockPath = await path()
    const stale = JSON.stringify({ pid: 2147483647 })
    await writeFile(lockPath, stale)
    const child = legacy(lockPath, 'reclaimer', stale)
    expect((await once(child, 'message'))[0]).toBe('observed')
    const lock = await acquire(lockPath)
    await windowsStartupNative().writeStartLock(lock.handle, JSON.stringify({ pid: process.pid }))
    const removed = once(child, 'message'); child.send('unlink')
    expect((await removed)[0]).toBe('protected')
    expect(await readFile(lockPath, 'utf8')).toContain(String(process.pid))
    await release(lock)
  })

  it('holds off an old contender until native release, then permits old startup', async () => {
    const lockPath = await path()
    const lock = await acquire(lockPath)
    await windowsStartupNative().writeStartLock(lock.handle, JSON.stringify({ pid: process.pid }))
    const child = legacy(lockPath)
    let entered = false
    child.on('message', () => { entered = true })
    await pause(200)
    expect(entered).toBe(false)
    const next = once(child, 'message')
    await release(lock)
    expect((await next)[0]).toBe('entered')
    const exited = once(child, 'exit'); child.send('release'); await exited
  })

  it.each(['acquire', 'metadata', 'child'])('releases both handles on native holder death at %s', async (stage) => {
    const lockPath = await path()
    const nativePath = join(windowsStartupDirectory(), 'kun_windows_startup.node')
    const child = spawn(process.execPath, ['-e', `
      const native = require(${JSON.stringify(nativePath)});
      (async () => {
        const lock = await native.acquireStartLock(${JSON.stringify(lockPath)});
        if (${JSON.stringify(stage)} !== 'acquire') await native.writeStartLock(lock.handle, JSON.stringify({pid:process.pid}));
        if (${JSON.stringify(stage)} === 'child') {
          const {spawn} = require('node:child_process');
          const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},500)'], {stdio:'ignore'});
          await new Promise(r=>child.once('spawn',r));
        }
        process.send('entered'); setInterval(()=>{ void lock.handle },1000);
      })().catch(e=>{console.error(e);process.exit(1)});
    `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    children.push(child)
    expect((await once(child, 'message'))[0]).toBe('entered')
    expect(await windowsStartupNative().acquireStartLock(lockPath)).toBeNull()
    const exited = once(child, 'exit'); child.kill(); await exited
    await release(await acquire(lockPath))
  })

  it('serializes independent native processes recovering the same corrupt metadata', async () => {
    const lockPath = await path()
    await writeFile(lockPath, '{')
    const events: string[] = []
    const nativePath = join(windowsStartupDirectory(), 'kun_windows_startup.node')
    await Promise.all(Array.from({ length: 6 }, async () => {
      const child = spawn(process.execPath, ['-e', `
        const n = require(${JSON.stringify(nativePath)});
        (async()=>{
          let lock; while(!(lock=await n.acquireStartLock(${JSON.stringify(lockPath)}))) await new Promise(r=>setTimeout(r,10));
          const fs = require('node:fs');
          fs.writeFileSync(${JSON.stringify(lockPath + '.critical')}, 'exclusive', {flag:'wx'});
          process.send('enter'); await n.writeStartLock(lock.handle, JSON.stringify({pid:process.pid}));
          await new Promise(r=>setTimeout(r,30)); process.send('leave');
          fs.unlinkSync(${JSON.stringify(lockPath + '.critical')});
          await n.releaseStartLock(lock.handle,true); process.exit(0);
        })().catch(e=>{console.error(e);process.exit(1)});
      `], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
      children.push(child)
      child.on('message', (value) => events.push(String(value)))
      expect((await once(child, 'exit'))[0]).toBe(0)
    }))
    expect(events.filter((value) => value === 'enter')).toHaveLength(6)
    expect(events.filter((value) => value === 'leave')).toHaveLength(6)
  })
})
