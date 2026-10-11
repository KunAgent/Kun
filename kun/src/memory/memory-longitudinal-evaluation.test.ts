import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FileMemoryStore } from './memory-store.js'
import { MemoryDistillationPendingStore } from './memory-distillation-pending-store.js'
import { buildMemoryToolProviders } from '../adapters/tool/memory-tool-provider.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host-core.js'
import { MEMORY_LONGITUDINAL_BASELINE_COMMIT } from './memory-longitudinal-evaluation-fixtures.js'
import { runMemoryLongitudinalReplay, type MemoryReplayPaths, type MemoryReplayRuntime } from './memory-longitudinal-evaluation.js'

const exec = promisify(execFile)
let paths: MemoryReplayPaths
beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-memory-longitudinal-'))
  paths = { root, project: join(root, 'project'), worktree: join(root, 'worktree'),
    alias: join(root, 'project-alias'), unrelated: join(root, 'unrelated') }
  await Promise.all([mkdir(paths.project), mkdir(paths.unrelated)])
  await exec('git', ['-C', paths.project, 'init'])
  await exec('git', ['-C', paths.project, '-c', 'user.name=Replay Test', '-c', 'user.email=replay@example.invalid',
    'commit', '--allow-empty', '-m', 'initial'])
  await exec('git', ['-C', paths.project, 'worktree', 'add', '-b', 'replay', paths.worktree])
  await exec('git', ['-C', paths.unrelated, 'init'])
  await symlink(paths.project, paths.alias, process.platform === 'win32' ? 'junction' : 'dir')
})
afterAll(async () => { if (paths) await rm(paths.root, { recursive: true, force: true }) })

describe('anonymous longitudinal memory replay', () => {
  it('passes every deterministic behavior gate and optionally compares the pinned runtime source', async () => {
    const upgraded = await runMemoryLongitudinalReplay({
      FileMemoryStore, MemoryDistillationPendingStore, buildMemoryToolProviders, LocalToolHost
    }, paths, 'upgraded')
    let baseline
    const baselineRoot = process.env.KUN_MEMORY_BASELINE_ROOT
    if (baselineRoot) {
      if (!isAbsolute(baselineRoot)) throw new Error('KUN_MEMORY_BASELINE_ROOT must be an absolute extracted source path')
      const [store, pending, provider, host] = await Promise.all([
        import(/* @vite-ignore */ `${baselineRoot}/src/memory/memory-store.ts`),
        import(/* @vite-ignore */ `${baselineRoot}/src/memory/memory-distillation-pending-store.ts`),
        import(/* @vite-ignore */ `${baselineRoot}/src/adapters/tool/memory-tool-provider.ts`),
        import(/* @vite-ignore */ `${baselineRoot}/src/adapters/tool/local-tool-host-core.ts`)
      ])
      baseline = await runMemoryLongitudinalReplay({ FileMemoryStore: store.FileMemoryStore,
        MemoryDistillationPendingStore: pending.MemoryDistillationPendingStore,
        buildMemoryToolProviders: provider.buildMemoryToolProviders, LocalToolHost: host.LocalToolHost
      } as MemoryReplayRuntime, paths, 'baseline')
      for (const previous of baseline.cases.filter((entry) => entry.passed)) {
        expect(upgraded.cases.find((entry) => entry.id === previous.id)?.passed, previous.id).toBe(true)
      }
      expect(upgraded.passed).toBeGreaterThan(baseline.passed)
    }
    const report = { dataset: 'checked-in-anonymous-longitudinal-scripts',
      baselineCommit: baseline ? MEMORY_LONGITUDINAL_BASELINE_COMMIT : null,
      baseline, upgraded, disclaimer: 'Deterministic storage/tool gates; not live-model task-success or semantic quality.' }
    console.info(JSON.stringify(report, null, 2))
    if (process.env.KUN_MEMORY_REPLAY_REPORT) {
      await writeFile(process.env.KUN_MEMORY_REPLAY_REPORT, `${JSON.stringify(report, null, 2)}\n`)
    }
    expect(upgraded.cases.filter((entry) => !entry.passed)).toEqual([])
    expect(upgraded.passed).toBe(upgraded.total)
    expect(upgraded.maxSerializedToolCharacters).toBeLessThanOrEqual(12_000)
    expect(upgraded.modelRequests).toBe(0)
  }, 60_000)
})
