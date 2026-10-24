import { describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectRuntimeProcess } from '../server/runtime-process-identity.js'
import { resolveWindowsExecutablePath } from './owned-process-windows.js'
import { quoteWindowsArgument, spawnWindowsOwnedProcess, stopWindowsOwnedProcess, shutdownWindowsOwnedProcesses, resumeWindowsOwnedProcessAdmission } from './owned-process-windows.js'

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH' }
}

async function waitUntil(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error('Windows Job fixture condition did not settle')
    await new Promise((accept) => setTimeout(accept, 25))
  }
}

describe('Windows executable argument encoding', () => {
  it('uses the same case-insensitive PATH and command suffix lookup for detection and launch', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-windows-command-'))
    try {
      await writeFile(join(directory, 'npm.cmd'), '@exit /b 0')
      expect(await resolveWindowsExecutablePath('npm', { env: { Path: directory } })).toBe(join(directory, 'npm.cmd'))
      expect(await resolveWindowsExecutablePath(join(directory, 'npm.cmd'), {})).toBe(join(directory, 'npm.cmd'))
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('preserves whitespace, trailing backslashes and embedded quotes without a shell', () => {
    expect(quoteWindowsArgument('plain')).toBe('plain')
    expect(quoteWindowsArgument('')).toBe('""')
    expect(quoteWindowsArgument('a b')).toBe('"a b"')
    expect(quoteWindowsArgument('a"b')).toBe('"a\\"b"')
    expect(quoteWindowsArgument('C:\\some path\\')).toBe('"C:\\some path\\\\"')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows owned Job integration', () => {
  it('preserves Node IPC and waits for the target Job to exit', async () => {
    resumeWindowsOwnedProcessAdmission()
    const child = await spawnWindowsOwnedProcess(process.execPath, ['-e',
      'process.send({pid:process.pid}); process.on("message",()=>process.exit(0)); setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    try {
      const result = await new Promise<{ pid: number }>((resolve) => child.once('message', resolve))
      expect(result.pid).toBe(child.pid)
      child.send('stop')
      await stopWindowsOwnedProcess(child, { graceMs: 1000, timeoutMs: 5000 })
      expect(child.exitCode).toBe(0)
    } finally { await shutdownWindowsOwnedProcesses({ timeoutMs: 5000 }) }
  }, 30_000)

  it('keeps its launcher and target alive for owner-loss draining, then kills the entire Job', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kun-windows-owner-loss-'))
    const entry = join(directory, 'owned-process.mjs')
    const fixture = join(directory, 'owner.mjs')
    const pidsPath = join(directory, 'pids.json')
    const checkpointPath = join(directory, 'after-owner-loss.json')
    const ownerLossGraceMs = 5_000
    const drainDelayMs = 1_500
    type FixturePids = { launcher: number; target: number; descendant: number }
    let owner: ChildProcess | undefined
    let pids: FixturePids | undefined
    const identities = new Map<number, string>()
    let jobExited = false
    let stderr = ''
    try {
      await build({
        entryPoints: [resolve(import.meta.dirname, 'owned-process-windows.ts')], outfile: entry,
        bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent'
      })
      const targetSource = `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
// A detached descendant avoids Node's own auto-kill Job, so only Kun's Job
// can provide the containment asserted by this fixture.
const descendant = spawn(process.execPath, ['-e',
  'process.send({pid:process.pid});setInterval(()=>{},1000)'], {
  detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc']
});
descendant.once('message', ({ pid }) => {
  const pids = { launcher: process.ppid, target: process.pid, descendant: pid };
  writeFileSync(${JSON.stringify(pidsPath)}, JSON.stringify(pids));
  process.send(pids);
});
process.on('disconnect', () => {
  setTimeout(() => writeFileSync(${JSON.stringify(checkpointPath)},
    JSON.stringify({ pid: process.pid, at: Date.now() })), ${drainDelayMs});
});
setInterval(() => {}, 1000);
`
      await writeFile(fixture, `
import { spawnWindowsOwnedProcess } from ${JSON.stringify(pathToFileURL(entry).href)};
const child = await spawnWindowsOwnedProcess(process.execPath, ['-e', ${JSON.stringify(targetSource)}], {
  detached: false, ownerLossGraceMs: ${ownerLossGraceMs},
  stdio: ['ignore', 'ignore', 'inherit', 'ipc'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
});
child.once('message', (pids) => process.send(pids));
setInterval(() => {}, 1000);
`)
      owner = spawn(process.execPath, [fixture], {
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1',
          KUN_PROCESS_STACK_OWNER_PID: '', KUN_PROCESS_STACK_OWNER_BIRTH: '0' }
      })
      owner.stderr!.on('data', (data) => { stderr = (stderr + String(data)).slice(-8192) })
      const fixtureOwner = owner
      pids = await new Promise<FixturePids>((accept, reject) => {
        const timer = setTimeout(() => reject(new Error(`Windows owner fixture did not become ready: ${stderr}`)), 20_000)
        fixtureOwner.once('message', (message) => { clearTimeout(timer); accept(message as FixturePids) })
        fixtureOwner.once('error', (error) => { clearTimeout(timer); reject(error) })
        fixtureOwner.once('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`Windows owner fixture exited (${code}): ${stderr}`))
        })
      })
      const fixturePids = Object.values(pids)
      expect(new Set([...fixturePids, owner.pid]).size).toBe(4)
      expect(fixturePids.every(alive)).toBe(true)
      for (const pid of fixturePids) {
        const identity = inspectRuntimeProcess(pid)?.identity
        expect(identity, `Fixture identity for PID ${pid}`).toBeDefined()
        if (identity) identities.set(pid, identity)
      }
      const killedAt = Date.now()
      expect(owner.kill('SIGKILL')).toBe(true)
      await waitUntil(() => fixtureOwner.exitCode !== null || fixtureOwner.signalCode !== null, 5_000)
      let checkpoint = ''
      await waitUntil(async () => {
        checkpoint = await readFile(checkpointPath, 'utf8').catch(() => '')
        if (!checkpoint && !fixturePids.every(alive)) {
          throw new Error(`Windows Job died before the owner-loss drain checkpoint: ${stderr}`)
        }
        return Boolean(checkpoint)
      }, ownerLossGraceMs)
      const drained = JSON.parse(checkpoint) as { pid: number; at: number }
      expect(drained.pid).toBe(pids.target)
      expect(drained.at - killedAt).toBeGreaterThanOrEqual(drainDelayMs - 100)
      expect(fixturePids.every(alive)).toBe(true)
      // The launcher reserves the last second of the configured deadline for
      // forced cleanup. Allow bounded test-runner scheduling overhead only.
      await waitUntil(() => fixturePids.every((pid) => !alive(pid)), ownerLossGraceMs + 5_000)
      expect(Date.now() - killedAt).toBeLessThan(ownerLossGraceMs + 5_000)
      expect(alive(pids.launcher)).toBe(false)
      expect(alive(pids.target)).toBe(false)
      expect(alive(pids.descendant)).toBe(false)
      jobExited = true
    } finally {
      if (owner && owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL')
      pids ??= JSON.parse(await readFile(pidsPath, 'utf8').catch(() => 'null')) as FixturePids | undefined
      if (!jobExited) {
        // Never signal an unverified or recycled PID, including on failed
        // assertions. The parent handle and native owner-loss watchdog still
        // reap launches that failed before their identities were captured.
        for (const [pid, identity] of identities) {
          if (!alive(pid) || inspectRuntimeProcess(pid)?.identity !== identity) continue
          try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ }
        }
        await waitUntil(() => Object.values(pids ?? {}).every((pid) => {
          if (!alive(pid)) return true
          const identity = identities.get(pid)
          const observed = identity ? inspectRuntimeProcess(pid)?.identity : undefined
          return Boolean(observed && observed !== identity)
        }), ownerLossGraceMs + 5_000)
      }
      await rm(directory, { recursive: true, force: true })
    }
  }, 40_000)

  it('fails closed before executing a suspended target when its final admission check rejects', async () => {
    resumeWindowsOwnedProcessAdmission()
    const directory = await mkdtemp(join(tmpdir(), 'kun-windows-rejected-job-'))
    const marker = join(directory, 'target-ran')
    let validations = 0
    try {
      await expect(spawnWindowsOwnedProcess(process.execPath, ['-e',
        'require("node:fs").writeFileSync(process.argv[1], "executed")', marker], {
        stdio: 'ignore', beforeLaunch: async () => {
          if (++validations === 2) throw new Error('Application admission was withdrawn')
        }
      })).rejects.toThrow('Application admission was withdrawn')
      expect(validations).toBe(2)
      expect(await readFile(marker, 'utf8').catch(() => '')).toBe('')
    } finally {
      await shutdownWindowsOwnedProcesses({ timeoutMs: 5_000 })
      await rm(directory, { recursive: true, force: true })
    }
  }, 30_000)
})
