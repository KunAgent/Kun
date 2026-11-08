import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareWindowsOwnedPty, resumeWindowsOwnedProcessAdmission, shutdownWindowsOwnedProcesses,
  spawnWindowsOwnedProcess, stopWindowsOwnedProcess
} from './owned-process-windows.js'

// Replace only the native executable boundary. The production resolver, gate,
// registration, filesystem, stop and cleanup code all run unchanged.
const launcher = vi.hoisted(() => ({ source: '', directories: [] as string[], failSpawn: false }))
vi.mock('./windows-startup-native.js', () => ({ windowsOwnedLauncherPath: () => 'controlled-native-launcher' }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (_file: string, _args: string[], options: SpawnOptions) => {
    launcher.directories.push(dirname(options.env!.KUN_OWNED_LAUNCH_CONFIG!))
    if (launcher.failSpawn) throw new Error('controlled spawn failure')
    return actual.spawn(process.execPath, ['-e', launcher.source], {
      ...options, detached: false, env: { ...options.env, ELECTRON_RUN_AS_NODE: '1' }
    })
  } }
})

const launcherSource = `
const fs = require('node:fs');
const config = fs.readFileSync(process.env.KUN_OWNED_LAUNCH_CONFIG, 'utf8').split('\\n');
const decode = i => Buffer.from(config[i], 'base64').toString();
const status = decode(3), stop = decode(4), resume = decode(9);
fs.writeFileSync(status, String(process.pid + 100000));
let resumed = false;
const timer = setInterval(() => {
  if (fs.existsSync(stop)) process.exit(0);
  if (!resumed && fs.existsSync(resume)) {
    resumed = true;
    if (process.env.TEST_RAN) fs.writeFileSync(process.env.TEST_RAN, 'executed');
    if (process.env.TEST_TARGET_EXIT) fs.writeFileSync(process.env.TEST_TARGET_EXIT, 'target exited');
    if (!process.env.TEST_WAIT_FOR) { process.stdout.write('helper output'); clearInterval(timer); }
  }
  if (resumed && process.env.TEST_WAIT_FOR && fs.existsSync(process.env.TEST_WAIT_FOR)) process.exit(0);
}, 5);
`
let directory: string
let command: string

beforeEach(async () => {
  resumeWindowsOwnedProcessAdmission()
  directory = await mkdtemp(join(tmpdir(), 'kun-controlled-job-'))
  command = join(directory, 'target.exe')
  await writeFile(command, 'placeholder for the controlled native boundary')
  launcher.source = launcherSource
  launcher.directories.length = 0
  launcher.failSpawn = false
})
afterEach(async () => {
  await shutdownWindowsOwnedProcesses({ timeoutMs: 2000 })
  resumeWindowsOwnedProcessAdmission()
  await rm(directory, { recursive: true, force: true })
})

const env = (extra: NodeJS.ProcessEnv = {}) => ({ ...process.env, ...extra })
async function gone(path: string) {
  await vi.waitFor(() => expect(existsSync(path)).toBe(false), { timeout: 3000 })
}
function closed(child: ChildProcess) {
  return new Promise<void>(accept => child.once('close', () => accept()))
}

describe('Windows owned launch lifecycle with a controlled native boundary', () => {
  it('releases registrations and directories after three normally exiting helpers', async () => {
    for (let index = 0; index < 3; index++) {
      const child = await spawnWindowsOwnedProcess(command, [], { env: env(), stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout!.resume()
      await closed(child)
      await gone(launcher.directories[index])
      // This public admission check fails while ANY stale launch remains.
      expect(() => resumeWindowsOwnedProcessAdmission()).not.toThrow()
      await stopWindowsOwnedProcess(child)
      await stopWindowsOwnedProcess(child)
    }
  })

  it('keeps ownership after target exit until the launcher confirms the remaining Job is empty', async () => {
    const targetExit = join(directory, 'target-exited')
    const helperExit = join(directory, 'helper-can-exit')
    const child = await spawnWindowsOwnedProcess(command, [], {
      env: env({ TEST_TARGET_EXIT: targetExit, TEST_WAIT_FOR: helperExit }), stdio: 'ignore'
    })
    await vi.waitFor(() => expect(existsSync(targetExit)).toBe(true))
    expect(existsSync(launcher.directories[0])).toBe(true)
    expect(() => resumeWindowsOwnedProcessAdmission()).toThrow('have not finished')
    const done = closed(child)
    await writeFile(helperExit, 'empty Job')
    await done
    await gone(launcher.directories[0])
    expect(() => resumeWindowsOwnedProcessAdmission()).not.toThrow()
  })

  it('shares idempotent cleanup between concurrent stops and launcher exit', async () => {
    const child = await spawnWindowsOwnedProcess(command, [], {
      env: env({ TEST_WAIT_FOR: join(directory, 'never') }), stdio: 'ignore'
    })
    await Promise.all([stopWindowsOwnedProcess(child), stopWindowsOwnedProcess(child)])
    await stopWindowsOwnedProcess(child)
    await gone(launcher.directories[0])
    expect(() => resumeWindowsOwnedProcessAdmission()).not.toThrow()
  })

  it('cleans prepared state when native creation throws synchronously', async () => {
    launcher.failSpawn = true
    await expect(spawnWindowsOwnedProcess(command, [], { env: env(), stdio: 'ignore' }))
      .rejects.toThrow('controlled spawn failure')
    await gone(launcher.directories[0])
    expect(() => resumeWindowsOwnedProcessAdmission()).not.toThrow()
  })

  it('cleans an asynchronous spawn failure without waiting for a nonexistent launcher', async () => {
    launcher.source = ''
    // Use a real failed ChildProcess (error/close, no exit event).
    const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const prepared = await prepareWindowsOwnedPty(command, [], { env: env() })
    const launchDir = dirname(prepared.env.KUN_OWNED_LAUNCH_CONFIG!)
    const failed = actual.spawn(join(directory, 'missing-native-launcher'), [], { stdio: 'ignore' })
    await expect(prepared.bind(failed)).rejects.toThrow()
    await gone(launchDir)
    expect(() => resumeWindowsOwnedProcessAdmission()).not.toThrow()
  })

  it('keeps PTY readiness suspended until explicit release and makes release idempotent', async () => {
    const marker = join(directory, 'target-ran')
    const prepared = await prepareWindowsOwnedPty(command, [], { env: env({ TEST_RAN: marker }) })
    const child = spawn(prepared.command, prepared.args, { env: prepared.env, stdio: 'ignore' })
    const launchDir = dirname(prepared.env.KUN_OWNED_LAUNCH_CONFIG!)
    await prepared.bind(child)
    expect(existsSync(join(launchDir, 'resume'))).toBe(false)
    expect(existsSync(marker)).toBe(false)
    const done = closed(child)
    prepared.release()
    prepared.release()
    await done
    expect(await readFile(marker, 'utf8')).toBe('executed')
    await gone(launchDir)
  })

  it('never writes resume or executes the target when final PTY validation rejects', async () => {
    const marker = join(directory, 'target-ran')
    const prepared = await prepareWindowsOwnedPty(command, [], { env: env({ TEST_RAN: marker }),
      beforeLaunch: async () => { throw new Error('launch proof expired') } })
    const child = spawn(prepared.command, prepared.args, { env: prepared.env, stdio: 'ignore' })
    const launchDir = dirname(prepared.env.KUN_OWNED_LAUNCH_CONFIG!)
    await expect(prepared.bind(child)).rejects.toThrow('launch proof expired')
    expect(existsSync(join(launchDir, 'resume'))).toBe(false)
    expect(existsSync(marker)).toBe(false)
    expect(() => prepared.release()).toThrow('not ready')
    await gone(launchDir)
  })

  it('keeps an already-ready PTY suspended when the upper final proof expires', async () => {
    const marker = join(directory, 'target-ran')
    let valid = true
    const validate = async () => { if (!valid) throw new Error('final proof expired') }
    const prepared = await prepareWindowsOwnedPty(command, [], { env: env({ TEST_RAN: marker }), beforeLaunch: validate })
    const child = spawn(prepared.command, prepared.args, { env: prepared.env, stdio: 'ignore' })
    const launchDir = dirname(prepared.env.KUN_OWNED_LAUNCH_CONFIG!)
    await prepared.bind(child)
    valid = false
    await expect(validate()).rejects.toThrow('final proof expired')
    // Check while the Job still owns its directory: absence is not merely a
    // consequence of removing the directory during failure cleanup.
    expect(existsSync(launchDir)).toBe(true)
    expect(existsSync(join(launchDir, 'resume'))).toBe(false)
    expect(existsSync(marker)).toBe(false)
    await stopWindowsOwnedProcess(child)
    expect(existsSync(marker)).toBe(false)
    await gone(launchDir)
  })

  it('stops a ready but cancelled PTY without releasing its target', async () => {
    const marker = join(directory, 'target-ran')
    const prepared = await prepareWindowsOwnedPty(command, [], { env: env({ TEST_RAN: marker }) })
    const child = spawn(prepared.command, prepared.args, { env: prepared.env, stdio: 'ignore' })
    await prepared.bind(child)
    const launchDir = dirname(prepared.env.KUN_OWNED_LAUNCH_CONFIG!)
    await stopWindowsOwnedProcess(child)
    expect(() => prepared.release()).toThrow('cannot resume')
    expect(existsSync(join(launchDir, 'resume'))).toBe(false)
    expect(existsSync(marker)).toBe(false)
    await stopWindowsOwnedProcess(child)
  })
})
