import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { windowsStartupDirectory, windowsStartupNative } from '../process/windows-startup-native.js'
import { withWindowsManagerStartLock } from './manager-start-lock-windows.js'

// Exercise the candidate backend directly; production activation is a separate
// mixed-version release gate, not a side effect of running these tests.
function withManagerStartLock<T>(directory: string, action: () => Promise<T>): Promise<T> {
  const start = performance.now()
  return withWindowsManagerStartLock(join(directory, '.manager-start.lock'),
    JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), action, start, start + 5_000)
}

const roots: string[] = []
const children: ChildProcess[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'Kun 中文 lock '))
  roots.push(path)
  return path
}
function child(code: string, args: string[]) {
  const process = spawn(globalThis.process.execPath, ['-e', code, ...args], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...globalThis.process.env, ELECTRON_RUN_AS_NODE: '1' } })
  children.push(process)
  return process
}
async function marker(process: ChildProcess) {
  const [chunk] = await once(process.stdout!, 'data')
  expect(String(chunk)).toContain('locked')
}
afterEach(async () => {
  for (const process of children.splice(0)) {
    if (process.exitCode === null && process.signalCode === null) {
      const exit = once(process, 'exit')
      process.kill()
      await exit
    }
  }
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform !== 'win32')('Windows independent-process startup mutex', () => {
  it.each(['acquire', 'publish'])('recovers after a caller is killed at %s', async (phase) => {
    const directory = await root()
    const path = join(directory, '.manager-start.lock')
    const binding = join(windowsStartupDirectory(), 'kun_windows_startup.node')
    const process = child(`const n=require(process.argv[1]); const l=n.acquire(process.argv[2]+'.guard',process.argv[2]);
      if(process.argv[3]==='publish') n.publish(l.handle,JSON.stringify({pid:process.pid}));
      global.lock=l; console.log('locked'); setInterval(()=>{},1000)`, [binding, path, phase])
    await marker(process)
    expect(windowsStartupNative().acquire(`${path}.guard`, path)).toBeUndefined()
    const exit = once(process, 'exit')
    process.kill()
    await exit
    await expect(withManagerStartLock(directory, async () => 'recovered')).resolves.toBe('recovered')
  })
  it('cannot overlap an old wx owner, and recovers after it exits', async () => {
    const directory = await root()
    const path = join(directory, '.manager-start.lock')
    const process = child(`const fs=require('fs'); const fd=fs.openSync(process.argv[1],'wx');
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,acquiredAt:new Date().toISOString()}));
      console.log('locked'); setInterval(()=>{},1000)`, [path])
    await marker(process)
    expect(windowsStartupNative().acquire(`${path}.guard`, path)).toBeUndefined()
    const exit = once(process, 'exit')
    process.kill()
    await exit
    await expect(withManagerStartLock(directory, async () => 'recovered')).resolves.toBe('recovered')
  })
  it('pins the legacy file against delayed unlink and old wx acquisition', async () => {
    const directory = await root()
    const path = join(directory, '.manager-start.lock')
    await withManagerStartLock(directory, async () => {
      const process = child(`const fs=require('fs'); let failures=0;
        try{fs.unlinkSync(process.argv[1])}catch{failures++}
        try{fs.openSync(process.argv[1],'wx')}catch{failures++}
        process.exit(failures===2?0:1)`, [path])
      const [code] = await once(process, 'exit')
      expect(code).toBe(0)
      expect(JSON.parse(await readFile(path, 'utf8')).pid).toBe(globalThis.process.pid)
    })
  })
  it.each(['', '{', '{}'])('recovers damaged metadata without a cache or PowerShell: %s', async (text) => {
    const directory = await root()
    await writeFile(join(directory, '.manager-start.lock'), text)
    await expect(withManagerStartLock(directory, async () => 'ready')).resolves.toBe('ready')
  })
  it('serializes independent contenders without removing a later owner', async () => {
    const directory = await root()
    const path = join(directory, '.manager-start.lock')
    const binding = join(windowsStartupDirectory(), 'kun_windows_startup.node')
    const code = `const fs=require('fs'); const n=require(process.argv[1]); const p=process.argv[2];
      let completed=0; const timer=setInterval(()=>{const l=n.acquire(p+'.guard',p); if(!l)return;
        try{fs.openSync(p+'.critical','wx'); n.publish(l.handle,JSON.stringify({pid:process.pid}));
          fs.unlinkSync(p+'.critical'); completed++}catch(e){console.error(e);process.exit(2)}finally{n.release(l.handle)}
        if(completed===20){clearInterval(timer);process.exit(0)}},2)`
    const exits = Array.from({ length: 4 }, () => once(child(code, [binding, path]), 'exit'))
    for (const [code] of await Promise.all(exits)) expect(code).toBe(0)
  })
})
