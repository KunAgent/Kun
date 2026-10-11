import { afterEach, describe, expect, it } from 'vitest'
import { createOwnedSdkProcessSpawner, spawnOwnedSdkProcess } from './owned-sdk-process.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses } from '../../process/owned-process.js'

afterEach(async () => {
  await shutdownOwnedProcesses({ graceMs: 50, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
})

describe('owned SDK process facade', () => {
  it('buffers SDK input until guarded launch and emits exit after the process terminates', async () => {
    const child = spawnOwnedSdkProcess({ command: process.execPath, args: ['-e',
      'process.stdin.on("data",data=>{process.stdout.write(data);process.exitCode=0});process.stdin.on("end",()=>{})'],
    env: process.env, signal: new AbortController().signal })
    let output = ''
    child.stdout.on('data', (data: Buffer) => { output += data.toString('utf8') })
    const exited = new Promise<number | null>((resolve, reject) => {
      child.on('exit', resolve)
      child.on('error', reject)
    })
    child.stdin.end('queued input\n')
    await expect(exited).resolves.toBe(0)
    expect(output).toBe('queued input\n')
  })

  it('reports cancellation before launch after the SDK can register its listeners', async () => {
    const controller = new AbortController()
    controller.abort()
    const child = spawnOwnedSdkProcess({ command: process.execPath, args: ['-e', 'process.exit(0)'],
      env: process.env, signal: controller.signal })
    const exited = new Promise<NodeJS.Signals | null>((resolve) => child.on('exit', (_code, signal) => resolve(signal)))
    await expect(exited).resolves.toBe('SIGTERM')
  })

  it.each(['disable', 'abort'] as const)('blocks target execution after %s during deferred SDK launch', async (change) => {
    const directory = await mkdtemp(join(tmpdir(), 'sdk-launch-admission-'))
    const marker = join(directory, 'target-ran')
    let release!: () => void
    let entered!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const pending = new Promise<void>((resolve) => { entered = resolve })
    let enabled = true
    let validations = 0
    const controller = new AbortController()
    const spawn = createOwnedSdkProcessSpawner(async () => {
      if (++validations === 2) { entered(); await blocked }
      if (!enabled) throw new Error('profile disabled')
    })
    const child = spawn({ command: process.execPath, args: ['-e',
      'require("node:fs").writeFileSync(process.argv[1], "executed")', marker],
    env: process.env, signal: controller.signal })
    let failure: Error | undefined
    child.on('error', (error) => { failure = error })
    const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()))
    try {
      await pending
      if (change === 'disable') enabled = false
      else controller.abort(new Error('cancelled'))
      release()
      await exited
      expect(failure?.message).toContain(change === 'disable' ? 'profile disabled' : 'cancelled')
      expect(await readFile(marker, 'utf8').catch(() => '')).toBe('')
    } finally { release(); await rm(directory, { recursive: true, force: true }) }
  }, 20_000)
})
