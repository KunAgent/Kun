import { describe, expect, it } from 'vitest'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import {
  INITIAL_PROMPT_ENHANCE_STATE,
  decidePromptEnhanceClick,
  isPromptEnhanceUndoShortcut,
  promptEnhanceReducer,
  resolvePromptEnhanceTarget,
  type PromptEnhanceAction,
  type PromptEnhanceState
} from './composer-prompt-enhance-state'

const groups: ModelProviderModelGroup[] = [
  { providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4-pro', 'deepseek-v4-flash'] },
  { providerId: 'claude-login', label: 'Claude Code', kind: 'agent-sdk', modelIds: ['sonnet'] }
]
const unpinned = { providerId: '', model: '' }

function run(actions: PromptEnhanceAction[], state: PromptEnhanceState = INITIAL_PROMPT_ENHANCE_STATE): PromptEnhanceState {
  return actions.reduce(promptEnhanceReducer, state)
}

const started: PromptEnhanceAction = { type: 'started', requestId: 'r1', source: 'rough draft', label: 'deepseek-v4-pro' }

describe('resolvePromptEnhanceTarget', () => {
  it('uses the composer model when it belongs to a Kun provider', () => {
    expect(resolvePromptEnhanceTarget({ settings: unpinned, providerId: 'deepseek', model: 'deepseek-v4-flash', kunGroups: groups, kunHarness: true }))
      .toEqual({ kind: 'ready', providerId: 'deepseek', model: 'deepseek-v4-flash', label: 'deepseek-v4-flash' })
  })

  it('finds the provider from the model on surfaces that pass no provider id', () => {
    expect(resolvePromptEnhanceTarget({ settings: unpinned, providerId: '', model: 'deepseek-v4-pro', kunGroups: groups, kunHarness: true }))
      .toMatchObject({ kind: 'ready', providerId: 'deepseek' })
  })

  it('falls back to Kun default when Kun runs an unresolved or Auto model', () => {
    expect(resolvePromptEnhanceTarget({ settings: unpinned, providerId: '', model: 'auto', kunGroups: groups, kunHarness: true }))
      .toEqual({ kind: 'ready', providerId: '', model: '', label: '' })
  })

  it('explains an agent that signs in on its own', () => {
    expect(resolvePromptEnhanceTarget({
      settings: unpinned, providerId: 'claude-login', model: 'sonnet', kunGroups: groups, kunHarness: false, agentLabel: 'Claude Code'
    })).toEqual({ kind: 'unsupported', agentLabel: 'Claude Code' })
    expect(resolvePromptEnhanceTarget({ settings: unpinned, providerId: '', model: 'route/coding', kunGroups: groups, kunHarness: false }))
      .toEqual({ kind: 'unsupported' })
    // An agent's own model id that happens to match a Kun model still belongs to the agent.
    expect(resolvePromptEnhanceTarget({
      settings: unpinned, providerId: '', model: 'deepseek-v4-pro', kunGroups: groups, kunHarness: false, agentLabel: 'DeepSeek CLI'
    })).toEqual({ kind: 'unsupported', agentLabel: 'DeepSeek CLI' })
  })

  it('lets a pinned model win even when the composer model is unsupported', () => {
    expect(resolvePromptEnhanceTarget({
      settings: { providerId: 'deepseek', model: '' }, providerId: 'claude-login', model: 'sonnet', kunGroups: groups, kunHarness: false, agentLabel: 'Claude Code'
    })).toEqual({ kind: 'ready', providerId: 'deepseek', model: '', label: 'DeepSeek' })
  })
})

describe('decidePromptEnhanceClick', () => {
  const ready = { kind: 'ready' as const, providerId: 'deepseek', model: 'deepseek-v4-pro', label: 'deepseek-v4-pro' }
  it('cancels while running, otherwise checks the draft and the model', () => {
    expect(decidePromptEnhanceClick({ state: run([started]), text: 'x', target: ready })).toBe('cancel')
    expect(decidePromptEnhanceClick({ state: INITIAL_PROMPT_ENHANCE_STATE, text: '  \n', target: ready })).toBe('empty')
    expect(decidePromptEnhanceClick({ state: INITIAL_PROMPT_ENHANCE_STATE, text: 'x', target: { kind: 'unsupported' } })).toBe('unsupported')
    expect(decidePromptEnhanceClick({ state: INITIAL_PROMPT_ENHANCE_STATE, text: 'x', target: ready })).toBe('start')
  })
})

describe('promptEnhanceReducer', () => {
  it('offers undo after a successful rewrite', () => {
    const state = run([started, {
      type: 'resolved', requestId: 'r1', result: { ok: true, text: 'Clear prompt', model: 'deepseek-v4-pro', providerId: 'deepseek' }
    }])
    expect(state).toEqual({ running: null, notice: null, undo: { original: 'rough draft', enhanced: 'Clear prompt', label: 'deepseek-v4-pro' } })
  })

  it('ignores the answer of a cancelled or superseded request', () => {
    const ok = { ok: true as const, text: 'late', model: 'm', providerId: 'p' }
    expect(run([started, { type: 'cancelled' }, { type: 'resolved', requestId: 'r1', result: ok }])).toEqual(INITIAL_PROMPT_ENHANCE_STATE)
    const restarted = run([started, { type: 'cancelled' }, { ...started, requestId: 'r2' }, { type: 'resolved', requestId: 'r1', result: ok }])
    expect(restarted.running?.requestId).toBe('r2')
  })

  it('maps failures to notices and drops a server-side cancel silently', () => {
    const fail = (code: 'failed' | 'timeout' | 'cancelled' | 'unsupported_model' | 'empty'): PromptEnhanceState =>
      run([started, { type: 'resolved', requestId: 'r1', result: { ok: false, code, message: `m-${code}` } }])
    expect(fail('failed').notice).toEqual({ kind: 'error', code: 'failed', message: 'm-failed' })
    expect(fail('timeout').notice).toEqual({ kind: 'error', code: 'timeout', message: 'm-timeout' })
    expect(fail('unsupported_model').notice).toEqual({ kind: 'unsupported' })
    expect(fail('empty').notice).toEqual({ kind: 'empty' })
    expect(fail('cancelled')).toEqual(INITIAL_PROMPT_ENHANCE_STATE)
  })

  it('keeps an earlier undo when a second rewrite fails, and hides it once the draft changes', () => {
    const done = run([started, { type: 'resolved', requestId: 'r1', result: { ok: true, text: 'v1', model: 'm', providerId: 'p' } }])
    const failed = run([{ ...started, requestId: 'r2', source: 'v1' }, { type: 'resolved', requestId: 'r2', result: { ok: false, code: 'failed', message: 'x' } }], done)
    expect(failed.undo?.original).toBe('rough draft')
    expect(run([{ type: 'dismissed' }], failed).undo?.enhanced).toBe('v1')
    expect(run([{ type: 'draft-changed', input: 'v1' }], done).undo).not.toBeNull()
    expect(run([{ type: 'draft-changed', input: 'v1 edited' }], done).undo).toBeNull()
  })

  it('clears the empty hint once the user types, and resets on thread switch', () => {
    const empty = run([{ type: 'blocked', notice: { kind: 'empty' } }])
    expect(run([{ type: 'draft-changed', input: '' }], empty).notice).toEqual({ kind: 'empty' })
    expect(run([{ type: 'draft-changed', input: 'a' }], empty).notice).toBeNull()
    expect(run([started, { type: 'reset' }])).toEqual(INITIAL_PROMPT_ENHANCE_STATE)
  })

  it('does not show a blocked notice over a running request', () => {
    expect(run([started, { type: 'blocked', notice: { kind: 'empty' } }]).notice).toBeNull()
  })
})

describe('isPromptEnhanceUndoShortcut', () => {
  const key = { key: 'z', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false }
  const done = run([started, { type: 'resolved', requestId: 'r1', result: { ok: true, text: 'v1', model: 'm', providerId: 'p' } }])
  it('only takes Cmd/Ctrl+Z while the rewrite is untouched', () => {
    expect(isPromptEnhanceUndoShortcut(key, done, 'v1')).toBe(true)
    expect(isPromptEnhanceUndoShortcut({ ...key, metaKey: false, ctrlKey: true }, done, 'v1')).toBe(true)
    expect(isPromptEnhanceUndoShortcut({ ...key, shiftKey: true }, done, 'v1')).toBe(false)
    expect(isPromptEnhanceUndoShortcut(key, done, 'v1 edited')).toBe(false)
    expect(isPromptEnhanceUndoShortcut(key, INITIAL_PROMPT_ENHANCE_STATE, 'v1')).toBe(false)
  })
})
