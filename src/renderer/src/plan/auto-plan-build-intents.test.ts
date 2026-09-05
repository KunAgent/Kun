import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_AUTO_PLAN_BUILD_INTENTS,
  activeAutoPlanBuildIntent,
  autoPlanBuildRequestFingerprint,
  clearAutoPlanBuildIntents,
  createAutoPlanBuildIntent,
  isAutoPlanIntermediatePlanCompletion,
  listAutoPlanBuildIntents,
  normalizeAutoPlanBuildIntent,
  normalizeAutoPlanBuildRegistry,
  patchAutoPlanBuildIntent,
  removeAutoPlanBuildIntent,
  saveAutoPlanBuildIntent
} from './auto-plan-build-intents'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('Automatic plan-build intent registry', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('strictly rejects malformed and incomplete scheduled intents', () => {
    expect(normalizeAutoPlanBuildIntent({ version: 1 })).toBeNull()
    const direct = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/a.md',
      relativePath: '.kunsdd/plan/a.md',
      workspaceRoot: '/repo',
      threadId: 'thread-1',
      selection: { buildMode: 'direct', useWorktree: true },
      now: 1
    })
    expect(normalizeAutoPlanBuildIntent(direct)).toEqual(direct)
    const { planTurnId: _planTurnId, ...legacy } = direct
    expect(normalizeAutoPlanBuildIntent(legacy)?.planTurnId).toBe('')
    expect(normalizeAutoPlanBuildIntent({ ...direct, buildMode: 'scheduled' })).toBeNull()
    expect(normalizeAutoPlanBuildIntent({ ...direct, status: 'complete' })).toBeNull()
  })

  it('creates a deterministic bounded request identity without storing prompt text', () => {
    const first = autoPlanBuildRequestFingerprint('same request')
    expect(first).toBe(autoPlanBuildRequestFingerprint('same request'))
    expect(first).not.toBe(autoPlanBuildRequestFingerprint('different request'))
    expect(first).not.toContain('same request')
  })

  it('binds, patches, and discovers a per-thread intent', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/a.md',
      relativePath: '.kunsdd/plan/a.md',
      workspaceRoot: '/repo',
      selection: { buildMode: 'direct', useWorktree: false },
      now: 1
    })
    saveAutoPlanBuildIntent(intent)
    expect(activeAutoPlanBuildIntent('thread-1')).toBeNull()
    patchAutoPlanBuildIntent(intent.id, {
      threadId: 'thread-1',
      planTurnId: 'turn-plan',
      status: 'dispatching'
    })
    expect(activeAutoPlanBuildIntent('thread-1')).toMatchObject({
      id: intent.id,
      planTurnId: 'turn-plan',
      status: 'dispatching',
      useWorktree: false
    })
    clearAutoPlanBuildIntents()
    expect(listAutoPlanBuildIntents()).toEqual([])
  })

  it('keeps only the newest bounded valid intents', () => {
    const intents = Array.from({ length: MAX_AUTO_PLAN_BUILD_INTENTS + 5 }, (_, index) =>
      createAutoPlanBuildIntent({
        planId: `/repo:.kunsdd/plan/${index}.md`,
        relativePath: `.kunsdd/plan/${index}.md`,
        workspaceRoot: '/repo',
        threadId: `thread-${index}`,
        selection: { buildMode: 'direct', useWorktree: true },
        now: index + 1
      }))
    const normalized = normalizeAutoPlanBuildRegistry({
      version: 1,
      intents: Object.fromEntries(intents.map((intent) => [intent.id, intent]))
    })
    expect(Object.keys(normalized.intents)).toHaveLength(MAX_AUTO_PLAN_BUILD_INTENTS)
    expect(Object.values(normalized.intents).some((intent) => intent.planId.endsWith('/0.md'))).toBe(false)
  })

  it('preserves exact one-shot scheduled configuration', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/scheduled.md',
      relativePath: '.kunsdd/plan/scheduled.md',
      workspaceRoot: '/repo',
      threadId: 'thread-s',
      selection: {
        buildMode: 'scheduled',
        useWorktree: true,
        scheduled: {
          providerId: 'codex',
          model: 'gpt-5.4',
          reasoningEffort: 'high',
          schedule: {
            kind: 'at',
            atTime: '2030-01-01T01:00:00.000Z',
            timeZone: 'Asia/Shanghai'
          }
        }
      }
    })
    expect(normalizeAutoPlanBuildIntent(intent)?.scheduled).toEqual(intent.scheduled)
  })

  it('fails closed when the recovery intent cannot be persisted', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => null,
        setItem: () => { throw new Error('quota exceeded') }
      }
    })
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/fail.md',
      relativePath: '.kunsdd/plan/fail.md',
      workspaceRoot: '/repo',
      threadId: 'thread-fail',
      selection: { buildMode: 'direct', useWorktree: true }
    })
    expect(saveAutoPlanBuildIntent(intent)).toBe(false)
  })

  it('recognizes only the exact intermediate plan turn of an automatic handoff', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/a.md',
      relativePath: '.kunsdd/plan/a.md',
      workspaceRoot: '/repo',
      threadId: 'thread-1',
      selection: { buildMode: 'direct', useWorktree: false }
    })
    saveAutoPlanBuildIntent(intent)
    patchAutoPlanBuildIntent(intent.id, { planTurnId: 'turn-plan', status: 'planning' })

    expect(isAutoPlanIntermediatePlanCompletion('thread-1', 'turn-plan')).toBe(true)
    expect(isAutoPlanIntermediatePlanCompletion('thread-1', 'turn-build')).toBe(false)
    expect(isAutoPlanIntermediatePlanCompletion('thread-other', 'turn-plan')).toBe(false)
    expect(isAutoPlanIntermediatePlanCompletion('thread-1', null)).toBe(false)
    expect(isAutoPlanIntermediatePlanCompletion(null, 'turn-plan')).toBe(false)
  })

  it('keeps dispatching intents exempt only for their own plan turn', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/b.md',
      relativePath: '.kunsdd/plan/b.md',
      workspaceRoot: '/repo',
      threadId: 'thread-2',
      selection: { buildMode: 'direct', useWorktree: true }
    })
    saveAutoPlanBuildIntent(intent)
    patchAutoPlanBuildIntent(intent.id, { planTurnId: 'turn-plan-2', status: 'dispatching' })

    expect(isAutoPlanIntermediatePlanCompletion('thread-2', 'turn-plan-2')).toBe(true)
    expect(isAutoPlanIntermediatePlanCompletion('thread-2', 'turn-other')).toBe(false)
  })

  it('does not silently exempt a plan that already needs attention', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/c.md',
      relativePath: '.kunsdd/plan/c.md',
      workspaceRoot: '/repo',
      threadId: 'thread-3',
      selection: { buildMode: 'direct', useWorktree: false }
    })
    saveAutoPlanBuildIntent(intent)
    patchAutoPlanBuildIntent(intent.id, { planTurnId: 'turn-plan-3', status: 'needs_attention' })

    expect(isAutoPlanIntermediatePlanCompletion('thread-3', 'turn-plan-3')).toBe(false)
  })

  it('provides limited thread-scoped compatibility for legacy intents without a plan turn id', () => {
    const intent = createAutoPlanBuildIntent({
      planId: '/repo:.kunsdd/plan/legacy.md',
      relativePath: '.kunsdd/plan/legacy.md',
      workspaceRoot: '/repo',
      threadId: 'thread-legacy',
      selection: { buildMode: 'direct', useWorktree: false }
    })
    saveAutoPlanBuildIntent(intent)

    expect(isAutoPlanIntermediatePlanCompletion('thread-legacy', 'turn-plan')).toBe(true)
    expect(isAutoPlanIntermediatePlanCompletion('thread-other', 'turn-plan')).toBe(false)

    removeAutoPlanBuildIntent(intent.id)
    expect(isAutoPlanIntermediatePlanCompletion('thread-legacy', 'turn-build')).toBe(false)
  })
})
