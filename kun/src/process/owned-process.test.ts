import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  beginOwnedProcessShutdown, resumeOwnedProcessAdmission,
  shutdownOwnedProcesses, spawnOwnedProcess, stopOwnedProcess
} from './owned-process.js'
import { OWNED_PROCESS_GUARD_SOURCE } from './owned-process-guard.js'

const directories: string[] = []
const fixtures: ChildProcess[] = []
const fixturePids = new Set<number>()

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Fixture condition did not settle')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function directory(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'kun-owned-process-'))
  directories.push(value)
  return value
}

function guardPid(): number {
  const rows = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n')
  for (const row of rows) {
    const [pidText, ppidText, ...command] = row.trim().split(/\s+/)
    if (Number(ppidText) === process.pid && command.join(' ').includes('KUN_PROCESS_STACK_OWNER_PID')) {
      return Number(pidText)
    }
  }
  throw new Error('Owned process guard not found')
}

afterEach(async () => {
  for (const child of fixtures) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') }
  fixtures.length = 0
  await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
  // Every PID here came from a purpose-created fixture. Cleanup never scans
  // the user's processes, including when an assertion fails.
  for (const pid of fixturePids) { try { process.kill(pid, 'SIGKILL') } catch { /* exited */ } }
  fixturePids.clear()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('POSIX owned process containment', () => {
  it('preserves exact argument boundaries, target PID and original Node IPC descriptor', async () => {
    const argument = 'literal $HOME `uname` $(touch /does-not-exist) "quote"'
    const child = await spawnOwnedProcess(process.execPath, ['-e',
      'process.send({pid:process.pid,arg:process.argv[1]});process.on("message",()=>process.exit(0))', argument],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    const message = await new Promise<{ pid: number; arg: string }>((resolve) => child.once('message', resolve))
    expect(message).toEqual({ pid: child.pid, arg: argument })
    child.send('finish')
    await stopOwnedProcess(child)
    expect(alive(message.pid)).toBe(false)
  })

  it('kills a TERM-resistant grandchild after the direct child has exited', async () => {
    const path = join(await directory(), 'grandchild.pid')
    const child = await spawnOwnedProcess(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const descendant=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
      require('node:fs').writeFileSync(process.argv[1],String(descendant.pid));
      descendant.unref();
    `, path], { stdio: 'ignore' })
    await waitUntil(async () => Boolean(await readFile(path, 'utf8').catch(() => '')))
    const pid = Number(await readFile(path, 'utf8'))
    fixturePids.add(pid)
    await waitUntil(() => child.exitCode !== null)
    expect(alive(pid)).toBe(true)
    await stopOwnedProcess(child, { graceMs: 100, timeoutMs: 4000 })
    await waitUntil(() => !alive(pid))
  })

  it('does not kill another independently owned group when one command stops', async () => {
    const first = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    const second = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    await stopOwnedProcess(first, { graceMs: 50, timeoutMs: 4000 })
    expect(alive(first.pid!)).toBe(false)
    expect(alive(second.pid!)).toBe(true)
    await shutdownOwnedProcesses({ exclude: [second], graceMs: 50, timeoutMs: 4000 })
    expect(alive(second.pid!)).toBe(true)
    await stopOwnedProcess(second, { graceMs: 50, timeoutMs: 4000 })
  })

  it('rejects command admission after shutdown starts', async () => {
    beginOwnedProcessShutdown()
    await expect(spawnOwnedProcess(process.execPath, ['-e', 'process.exit(0)'])).rejects.toThrow('admission')
  })

  it('awaits guard exit once and treats repeated shutdown as completed', async () => {
    await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
    await expect(shutdownOwnedProcesses()).resolves.toBeUndefined()
  })

  it('keeps a registered group alive when the owner channel drops but the owner lives', async () => {
    const parent = spawn(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const guard=spawn(process.execPath,['-e',${JSON.stringify(OWNED_PROCESS_GUARD_SOURCE)}],
        {stdio:['ignore','ignore','ignore','ipc'],detached:true});
      let target;
      guard.on('message',message=>{
        if(message.ready){
          target=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
          target.once('spawn',()=>guard.send({type:'register',id:1,pid:target.pid,ownerLossGraceMs:800}));
        }else if(message.id===1){
          guard.disconnect();
          process.send({target:target.pid,guard:guard.pid});
        }
      });
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    fixtures.push(parent)
    const message = await new Promise<{ target: number; guard: number }>((resolve) => parent.once('message', resolve))
    fixturePids.add(message.target)
    fixturePids.add(message.guard)
    // A lost channel is not proof of owner death: the stack must stay up.
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(alive(message.target)).toBe(true)
    expect(alive(message.guard)).toBe(true)
    // Only a confirmed owner death brings the supervised group down.
    parent.kill('SIGKILL')
    await waitUntil(() => !alive(message.target) && !alive(message.guard), 8000)
  })

  it('starts a fresh guard for the next launch after the guard process dies', async () => {
    const first = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    fixturePids.add(first.pid!)
    const deadGuard = guardPid()
    process.kill(deadGuard, 'SIGKILL')
    await waitUntil(() => !alive(deadGuard))
    expect(alive(first.pid!)).toBe(true)
    const second = await spawnOwnedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    expect(alive(second.pid!)).toBe(true)
    expect(guardPid()).not.toBe(deadGuard)
  })

  it('an independent guard reaps a stopped child after its owner is SIGKILLed', async () => {
    const parent = spawn(process.execPath, ['-e', `
      const {spawn}=require('node:child_process');
      const guard=spawn(process.execPath,['-e',${JSON.stringify(OWNED_PROCESS_GUARD_SOURCE)}],
        {stdio:['ignore','ignore','inherit','ipc'],detached:true});
      let target;
      guard.on('message',message=>{
        if(message.ready){
          target=spawn('/bin/sh',['-c','read token <&3 || exit 125; exec "$@"','fixture',
            process.execPath,'-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore','ignore','ignore','pipe']});
          target.once('spawn',()=>guard.send({type:'register',id:1,pid:target.pid,ownerLossGraceMs:800}));
        }else if(message.id===1){
          target.stdio[3].end('start\\n');
          process.send({target:target.pid,guard:guard.pid});
        }
      });
    `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    fixtures.push(parent)
    const message = await new Promise<{ target: number; guard: number }>((resolve) => parent.once('message', resolve))
    fixturePids.add(message.target)
    fixturePids.add(message.guard)
    process.kill(message.target, 'SIGSTOP')
    parent.kill('SIGKILL')
    await waitUntil(() => !alive(message.target) && !alive(message.guard), 5000)
  })
})
