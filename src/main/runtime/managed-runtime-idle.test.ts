import { describe, expect, it } from 'vitest'
import {
  runtimeThreadsListHasActiveTurn,
  waitForRuntimeTurnsIdle,
  type RuntimeThreadsListResult
} from './managed-runtime-idle'
import {
  defaultClawSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '../../shared/app-settings'

const settings: AppSettingsV1 = {
  version: 1,
  locale: 'en',
  theme: 'system',
  uiFontScale: 0.82,
  provider: defaultModelProviderSettings(),
  agents: { kun: defaultKunRuntimeSettings() },
  workspaceRoot: '/tmp/workspace',
  conversationWorkspaceRoot: '~/Documents/Kun',
  log: { enabled: false, retentionDays: 7 },
  checkpointCleanup: { enabled: false, intervalDays: 3 },
  notifications: { turnComplete: true },
  appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
  keyboardShortcuts: defaultKeyboardShortcuts(),
  write: defaultWriteSettings(),
  claw: defaultClawSettings(),
  schedule: defaultScheduleSettings(),
  workflow: defaultWorkflowSettings(),
  terminal: defaultTerminalSettings(),
  guiUpdate: { channel: 'stable' },
  codePromptPrefix: '',
  disabledSkillIds: []
}

function ok(body: unknown): RuntimeThreadsListResult {
  return { ok: true, status: 200, body: JSON.stringify(body) }
}

describe('runtimeThreadsListHasActiveTurn', () => {
  it('detects running thread summaries', () => {
    expect(runtimeThreadsListHasActiveTurn(JSON.stringify({
      threads: [{ id: 'thr_1', status: 'running' }]
    }))).toBe(true)
  })

  it('detects running turns if a hydrated response includes them', () => {
    expect(runtimeThreadsListHasActiveTurn(JSON.stringify({
      threads: [{ id: 'thr_1', status: 'idle', turns: [{ id: 'turn_1', status: 'queued' }] }]
    }))).toBe(true)
  })

  it('treats idle or malformed lists as idle', () => {
    expect(runtimeThreadsListHasActiveTurn(JSON.stringify({
      threads: [{ id: 'thr_1', status: 'idle', turns: [{ id: 'turn_1', status: 'completed' }] }]
    }))).toBe(false)
    expect(runtimeThreadsListHasActiveTurn('not json')).toBe(false)
  })
})

describe('waitForRuntimeTurnsIdle', () => {
  it('waits until the runtime reports no active turns', async () => {
    const responses = [
      ok({ threads: [{ id: 'thr_1', status: 'running' }] }),
      ok({ threads: [{ id: 'thr_1', status: 'idle' }] })
    ]
    const sleeps: number[] = []

    const result = await waitForRuntimeTurnsIdle({
      settings,
      fetchThreads: async () => responses.shift() ?? ok({ threads: [] }),
      sleepMs: async (ms) => { sleeps.push(ms) },
      intervalMs: 25,
      timeoutMs: 100
    })

    expect(result).toBe('idle')
    expect(sleeps).toEqual([25])
  })

  it('returns unavailable instead of blocking if the runtime cannot be queried', async () => {
    await expect(waitForRuntimeTurnsIdle({
      settings,
      fetchThreads: async () => ({ ok: false, status: 500, body: 'oops' }),
      sleepMs: async () => undefined,
      timeoutMs: 100
    })).resolves.toBe('unavailable')
  })
})
