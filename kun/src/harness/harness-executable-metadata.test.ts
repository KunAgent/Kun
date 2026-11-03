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
it('prefers qodercli over the desktop IDE launcher and never falls back to the bare qoder name', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kun-qoder-detection-'))
  try {
    const ide = join(dir, 'Qoder.app/Contents/Resources/app/bin/qoder')
    await mkdir(join(ide, '..'), { recursive: true }); await writeFile(ide, 'desktop launcher')
    const qoder = BUILTIN_HARNESSES.find((value) => value.id === 'qoder')!
    expect(qoder.detect?.command).toBe('qodercli')
    expect(qoder.launch?.command).toBe('qodercli')
    expect(qoder.setup?.login?.command).toBe('qodercli')
    const probeLogin = vi.fn(async () => 'unknown' as const)
    const make = (installed: boolean) => new HarnessDetector({ definitions: () => [qoder], overrides: () => ({}),
      resolveExecutable: async (name) => name === 'qoder' ? ide : name === 'qodercli' && installed ? '/fixture/qodercli' : undefined,
      spawnCaptured: vi.fn(async () => ({ stdout: '1.1.67', stderr: '', exitCode: 0, timedOut: false })),
      probeLogin, nowMs: Date.now, nowIso: () => new Date().toISOString() })
    expect(await make(true).status('qoder')).toMatchObject({ installed: 'yes', resolvedCommand: '/fixture/qodercli' })
    expect(await make(false).status('qoder')).toMatchObject({ installed: 'no', message: 'command not found: qodercli' })
  } finally { await rm(dir, { recursive: true, force: true }) }
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
