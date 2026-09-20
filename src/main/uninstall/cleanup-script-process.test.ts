import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeCleanupScripts } from './cleanup-script'

const roots: string[] = []
const groups = new Set<number>()
afterEach(async () => {
  for (const pid of groups) { try { process.kill(-pid, 'SIGKILL') } catch { /* already exited */ } }
  groups.clear()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture(mainPid: number, helperTimeoutSeconds = 5, mainWaitSeconds = 60) {
  const root = await mkdtemp(join(tmpdir(), 'kun-uninstall-lifetime-'))
  roots.push(root)
  const data = join(root, 'owned-test-data')
  await mkdir(data)
  await writeFile(join(data, 'preserved.txt'), 'test data')
  const output = await writeCleanupScripts({ operationId: 'isolated-test-operation', mainPid,
    guardCommandSubstring: 'unused-no-main-kill', deleteDataPaths: [data], appRemovalMode: 'none',
    platform: process.platform, tempRoot: root, helperTimeoutSeconds, mainWaitSeconds })
  const child = spawn('/bin/sh', [output.scriptPath], { detached: true, stdio: 'ignore' })
  groups.add(child.pid!)
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  return { child, exited, data, output }
}
async function expectGroupGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    try { process.kill(-pid, 0) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') { groups.delete(pid); return }
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Uninstall helper or its watchdog remained alive')
}

describe.skipIf(process.platform === 'win32')('one-shot uninstall helper real processes', () => {
  it('deletes only its temporary fixture after Main exit and reaps its watchdog', async () => {
    const test = await fixture(2_147_483_647)
    expect(await test.exited).toMatchObject({ code: 0 })
    await expect(stat(test.data)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(test.output.markerDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expectGroupGone(test.child.pid!)
  })

  it('times out waiting for live Main without killing it or deleting its data', async () => {
    const test = await fixture(process.pid, 5, 0)
    expect(await test.exited).toMatchObject({ code: 124 })
    expect(process.kill(process.pid, 0)).toBe(true)
    await expect(stat(test.data)).resolves.toBeDefined()
    await expect(stat(test.output.markerDir)).resolves.toBeDefined()
    await expectGroupGone(test.child.pid!)
  })

  it('enforces an independent whole-group deadline if the handoff never completes', async () => {
    const test = await fixture(process.pid, 1, 90)
    expect(await test.exited).toMatchObject({ signal: 'SIGKILL' })
    await expect(stat(test.data)).resolves.toBeDefined()
    await expectGroupGone(test.child.pid!)
  })
})
