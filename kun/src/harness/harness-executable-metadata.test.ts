import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { HarnessDetector } from './harness-detector.js'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
it('rejects a Grok alias named agent instead of routing it as Cursor', async () => {
  const definition = BUILTIN_HARNESSES.find((value) => value.id === 'cursor-cli')!
  const probeLogin = vi.fn(async () => 'unknown' as const)
  const detector = new HarnessDetector({ definitions: () => [definition], overrides: () => ({}),
    resolveExecutable: async () => '/fixture/agent', spawnCaptured: vi.fn(async () => ({ stdout: 'grok 1.0.5', stderr: '', exitCode: 0, timedOut: false })),
    probeLogin, nowMs: Date.now, nowIso: () => new Date().toISOString() })
  expect(await detector.status(definition.id)).toMatchObject({ installed: 'no', reasonCode: 'not_installed' })
  expect(probeLogin).not.toHaveBeenCalled()
})
it('does not launch a desktop Qoder script or self-updating Droid bootstrap during discovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-cli-detection-'))
  try {
    const path = join(dir, 'Qoder.app/Contents/Resources/app/bin/code')
    await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'desktop launcher')
    const qoder = BUILTIN_HARNESSES.find((value) => value.id === 'qoder')!
    const droid = BUILTIN_HARNESSES.find((value) => value.id === 'droid')!
    const spawnCaptured = vi.fn(), login = vi.fn(async () => 'unknown' as const)
    const detector = new HarnessDetector({ definitions: () => [qoder, droid], overrides: () => ({}),
      resolveExecutable: async (id) => id === 'qoder' ? path : id === 'droid' ? '/fixture/droid' : undefined,
      spawnCaptured, probeLogin: login, nowMs: Date.now, nowIso: () => new Date().toISOString() })
    expect(await detector.status('qoder')).toMatchObject({ installed: 'no' })
    expect(await detector.status('droid')).toMatchObject({ installed: 'yes', version: undefined })
    expect(spawnCaptured).not.toHaveBeenCalled()
  } finally { await rm(dir, { recursive: true, force: true }) }
})
