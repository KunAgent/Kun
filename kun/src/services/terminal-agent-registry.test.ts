import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityStore } from './activity-store.js'
import { TerminalAgentRegistry } from './terminal-agent-registry.js'
import type { ActivityPatch, ActivityProvenance, RegisterUnit } from '../contracts/activity.js'

const NOW = '2026-09-10T10:00:00.000Z'
const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kun-term-agents-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

function harness(dataDir: string) {
  const applied: Array<{ unitId: string; patch: ActivityPatch; provenance: string }> = []
  const registered: RegisterUnit[] = []
  const registry = new TerminalAgentRegistry({
    dataDir,
    nowIso: () => NOW,
    idGenerator: (() => { let n = 0; return () => `tu_${++n}` })(),
    activity: {
      register: (input) => { registered.push(input); return input },
      apply: (unitId, patch, provenance) => { applied.push({ unitId, patch, provenance }) }
    }
  })
  return { registry, applied, registered }
}

const CREATE = {
  harnessId: 'claude-code' as const,
  title: 'terminal claude',
  workspace: { path: '/ws/task', kind: 'worktree' as const, branch: 'ade/task' }
}

describe('TerminalAgentRegistry', () => {
  it('registers a unit, persists it, and opens a working activity row', async () => {
    const { registry, registered } = harness(await tempDir())
    const record = await registry.register({ ...CREATE, parentThreadId: 'th_1' })
    expect(record.unitId).toBe('tu_1')
    expect(registered[0]).toMatchObject({
      unitId: 'tu_1',
      kind: 'terminal-agent',
      threadId: 'tu_1',
      parentThreadId: 'th_1',
      harnessId: 'claude-code',
      mainState: 'working',
      provenance: 'runtime'
    })
    expect((await registry.get('tu_1'))?.mainState).toBe('working')
  })

  it('closes the row on exit reports', async () => {
    const { registry, applied } = harness(await tempDir())
    await registry.register(CREATE)
    const record = await registry.reportExit('tu_1', { exitCode: 0 })
    expect(record?.exitCode).toBe(0)
    expect(applied.at(-1)).toMatchObject({
      unitId: 'tu_1',
      patch: { mainState: 'closed', lastOutcome: 'completed' },
      provenance: 'runtime'
    })
    await registry.register({ ...CREATE, title: 'second' })
    await registry.reportExit('tu_2', { exitCode: 130, signal: 'SIGINT' })
    expect(applied.at(-1)?.patch.lastOutcome).toBe('failed')
  })

  it('reports null for unknown units', async () => {
    const { registry } = harness(await tempDir())
    expect(await registry.reportExit('nope', { exitCode: 0 })).toBeNull()
    expect(await registry.interruptHint('nope')).toBe(false)
  })

  it('stores and consumes interrupt hints', async () => {
    const { registry } = harness(await tempDir())
    await registry.register(CREATE)
    expect(await registry.consumeInterruptHint('tu_1')).toBe(false)
    expect(await registry.interruptHint('tu_1')).toBe(true)
    expect(await registry.consumeInterruptHint('tu_1')).toBe(true)
    expect(await registry.consumeInterruptHint('tu_1')).toBe(false)
    // Closed units stop accepting hints.
    await registry.reportExit('tu_1', { exitCode: 0 })
    expect(await registry.interruptHint('tu_1')).toBe(false)
  })

  it('restores live units as restoredUnconfirmed rows', async () => {
    const dir = await tempDir()
    const first = harness(dir)
    await first.registry.register(CREATE)
    await first.registry.register({ ...CREATE, title: 'closed one' })
    await first.registry.reportExit('tu_2', { exitCode: 0 })

    const second = harness(dir)
    expect(await second.registry.restore()).toBe(1)
    expect(second.registered).toHaveLength(1)
    expect(second.registered[0]).toMatchObject({
      unitId: 'tu_1',
      kind: 'terminal-agent',
      mainState: 'working',
      provenance: 'restored',
      restoredUnconfirmed: true
    })
  })

  it('persists hook-driven state changes across restarts', async () => {
    const dir = await tempDir()
    const first = harness(dir)
    await first.registry.register(CREATE)
    await first.registry.applyState('tu_1', { mainState: 'idle', provenance: 'hook' })
    const second = harness(dir)
    expect((await second.registry.get('tu_1'))?.mainState).toBe('idle')
  })

  it('persists native session ids reported by SessionStart hooks', async () => {
    const { registry } = harness(await tempDir())
    await registry.register(CREATE)
    await registry.applyState('tu_1', {
      mainState: 'idle', nativeSessionId: 'sess_native', provenance: 'hook'
    })
    expect((await registry.get('tu_1'))?.nativeSessionId).toBe('sess_native')
  })

  it('removes the managed-hook config directory on exit', async () => {
    const dir = await tempDir()
    const { registry } = harness(dir)
    await registry.register(CREATE)
    const hookDir = join(dir, 'ade', 'hooks', 'tu_1')
    await mkdir(hookDir, { recursive: true })
    await writeFile(join(hookDir, 'settings.json'), '{}')
    await registry.reportExit('tu_1', { exitCode: 0 })
    expect(existsSync(hookDir)).toBe(false)
  })

  it('throttles tier-0 progress writes with callback provenance', async () => {
    let now = 0
    const dir = await tempDir()
    const applied: Array<{ unitId: string; patch: ActivityPatch; provenance: string }> = []
    const registry = new TerminalAgentRegistry({
      dataDir: dir,
      nowIso: () => NOW,
      nowMs: () => now,
      idGenerator: () => 'tu_1',
      activity: {
        register: (input) => input,
        apply: (unitId, patch, provenance) => { applied.push({ unitId, patch, provenance }) }
      }
    })
    await registry.register(CREATE)
    expect(await registry.reportProgress('tu_1', { summary: 'first', phase: 'implementing' }))
      .toBe('recorded')
    expect(await registry.reportProgress('tu_1', { summary: 'second' })).toBe('rate_limited')
    now += 10_001
    expect(await registry.reportProgress('tu_1', { summary: 'third' })).toBe('recorded')
    expect(await registry.reportProgress('tu_ghost', { summary: 'x' })).toBe('unknown')
    expect(applied.map((entry) => entry.patch.progressNote)).toEqual(['first', 'third'])
    expect(applied[0]?.provenance).toBe('callback')
  })
})

describe('ActivityStore authority for terminal agents', () => {
  it('accepts hook and inferred mainState writes', () => {
    const store = new ActivityStore({ nowIso: () => NOW })
    store.register({
      unitId: 'tu_9',
      kind: 'terminal-agent',
      threadId: 'tu_9',
      harnessId: 'claude-code',
      title: 't',
      workspace: { path: '/ws', kind: 'local' }
    })
    store.apply('tu_9', { mainState: 'idle' }, 'hook')
    expect(store.get('tu_9')?.mainState).toBe('idle')
    store.apply('tu_9', { mainState: 'done', lastOutcome: 'cancelled' }, 'inferred')
    expect(store.get('tu_9')).toMatchObject({ mainState: 'done', lastOutcome: 'cancelled', provenance: 'inferred' })
  })
})
