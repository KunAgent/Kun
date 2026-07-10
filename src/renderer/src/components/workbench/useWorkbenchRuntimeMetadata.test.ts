import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const hookHarness = vi.hoisted(() => {
  type Cleanup = () => void
  type Effect = () => void | Cleanup
  const states: unknown[] = []
  const refs: Array<{ current: unknown }> = []
  const effects: Array<{ deps?: unknown[]; cleanup?: Cleanup }> = []
  const pendingEffects: Array<() => void> = []
  let stateIndex = 0
  let refIndex = 0
  let effectIndex = 0

  const depsChanged = (previous: unknown[] | undefined, next: unknown[] | undefined): boolean =>
    !previous || !next || previous.length !== next.length || previous.some((value, index) => !Object.is(value, next[index]))

  return {
    beginRender(): void {
      stateIndex = 0
      refIndex = 0
      effectIndex = 0
    },
    flushEffects(): void {
      for (const run of pendingEffects.splice(0)) run()
    },
    reset(): void {
      for (const effect of effects) effect.cleanup?.()
      states.length = 0
      refs.length = 0
      effects.length = 0
      pendingEffects.length = 0
      stateIndex = 0
      refIndex = 0
      effectIndex = 0
    },
    useEffect(effect: Effect, deps?: unknown[]): void {
      const index = effectIndex++
      const slot = effects[index] ?? {}
      effects[index] = slot
      if (!depsChanged(slot.deps, deps)) return
      pendingEffects.push(() => {
        slot.cleanup?.()
        const cleanup = effect()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
        slot.deps = deps
      })
    },
    useRef<T>(initial: T): { current: T } {
      const index = refIndex++
      if (!refs[index]) refs[index] = { current: initial }
      return refs[index] as { current: T }
    },
    useState<T>(initial: T): [T, (value: T | ((current: T) => T)) => void] {
      const index = stateIndex++
      if (!(index in states)) states[index] = initial
      return [
        states[index] as T,
        (value) => {
          states[index] = typeof value === 'function'
            ? (value as (current: T) => T)(states[index] as T)
            : value
        }
      ]
    }
  }
})

const runtime = vi.hoisted(() => ({
  getRuntimeInfo: vi.fn(),
  listSkills: vi.fn(),
  listLocalSkills: vi.fn()
}))

vi.mock('react', () => ({
  useEffect: hookHarness.useEffect,
  useRef: hookHarness.useRef,
  useState: hookHarness.useState
}))

vi.mock('../../agent/registry', () => ({
  getProvider: () => ({
    getRuntimeInfo: runtime.getRuntimeInfo,
    listSkills: runtime.listSkills
  })
}))

import { useWorkbenchRuntimeMetadata } from './useWorkbenchRuntimeMetadata'

const baselineSkill = {
  id: 'baseline',
  name: 'Baseline',
  root: '/workspace/.kun/skills/baseline',
  scope: 'project' as const,
  legacy: true
}

function RuntimeMetadataHookProbe(skillMenuOpen: boolean) {
  hookHarness.beginRender()
  const result = useWorkbenchRuntimeMetadata({
    activeSkillWorkspace: '/workspace',
    runtimeConnection: 'ready',
    skillMenuOpen
  })
  hookHarness.flushEffects()
  return result
}

async function mountClosedMenu(): Promise<void> {
  RuntimeMetadataHookProbe(false)
  await vi.waitFor(() => expect(runtime.listLocalSkills).toHaveBeenCalledTimes(1))
  await Promise.resolve()
  RuntimeMetadataHookProbe(false)
  runtime.listSkills.mockClear()
  runtime.listLocalSkills.mockClear()
}

describe('useWorkbenchRuntimeMetadata', () => {
  beforeEach(() => {
    hookHarness.reset()
    runtime.getRuntimeInfo.mockReset().mockResolvedValue(null)
    runtime.listSkills.mockReset().mockResolvedValue([])
    runtime.listLocalSkills.mockReset().mockResolvedValue({
      ok: true,
      skills: [baselineSkill],
      validationErrors: []
    })
    vi.stubGlobal('window', {
      kunGui: { listSkills: runtime.listLocalSkills }
    })
  })

  afterEach(() => {
    hookHarness.reset()
    vi.unstubAllGlobals()
  })

  it('reloads Skills once on closed-to-open and not while the menu remains open', async () => {
    await mountClosedMenu()

    RuntimeMetadataHookProbe(true)
    await vi.waitFor(() => expect(runtime.listLocalSkills).toHaveBeenCalledTimes(1))
    expect(runtime.listSkills).toHaveBeenCalledTimes(1)

    RuntimeMetadataHookProbe(true)
    expect(runtime.listLocalSkills).toHaveBeenCalledTimes(1)
    expect(runtime.listSkills).toHaveBeenCalledTimes(1)
  })

  it('ignores a stale Skill response when the menu closes before it resolves', async () => {
    await mountClosedMenu()
    let resolveLocalSkills!: (value: {
      ok: true
      skills: Array<typeof baselineSkill>
      validationErrors: []
    }) => void
    runtime.listLocalSkills.mockReturnValueOnce(new Promise((resolve) => {
      resolveLocalSkills = resolve
    }))

    RuntimeMetadataHookProbe(true)
    RuntimeMetadataHookProbe(false)
    resolveLocalSkills({
      ok: true,
      skills: [{ ...baselineSkill, id: 'stale', name: 'Stale' }],
      validationErrors: []
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(RuntimeMetadataHookProbe(false).runtimeSkills).toEqual([baselineSkill])
  })
})
