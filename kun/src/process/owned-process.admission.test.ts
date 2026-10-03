import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resumeOwnedProcessAdmission, shutdownOwnedProcesses, spawnOwnedProcess } from './owned-process.js'

const directories: string[] = []
afterEach(async () => {
  await shutdownOwnedProcesses({ graceMs: 0, timeoutMs: 4000 })
  resumeOwnedProcessAdmission()
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('owned executable admission gate', () => {
  it.each(['disable', 'abort'] as const)('never executes target code after %s while registered launch is pending', async (change) => {
    const directory = await mkdtemp(join(tmpdir(), 'owned-admission-')); directories.push(directory)
    const marker = join(directory, 'target-ran')
    let release!: () => void
    let reached!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { reached = resolve })
    let validations = 0
    let enabled = true
    const controller = new AbortController()
    const launch = spawnOwnedProcess(process.execPath, ['-e',
      'require("node:fs").writeFileSync(process.argv[1], "executed")', marker], {
      stdio: 'ignore',
      beforeLaunch: async () => {
        if (++validations === 2) { reached(); await blocked }
        controller.signal.throwIfAborted()
        if (!enabled) throw new Error('profile disabled')
      }
    })
    const rejected = expect(launch).rejects.toThrow(change === 'abort' ? 'cancelled' : 'profile disabled')
    await entered
    if (change === 'disable') enabled = false
    else controller.abort(new Error('cancelled'))
    release()
    await rejected
    expect(validations).toBe(2)
    expect(await readFile(marker, 'utf8').catch(() => '')).toBe('')
  }, 20_000)
})
