import { describe, expect, it } from 'vitest'
import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  defaultRemoteAccessSettings,
  type AppSettingsV1
} from '@shared/app-settings'
import { buildAdeReadinessChecks } from './ade-readiness'

function settings(overrides: {
  apiKey?: string
  model?: string
  providerName?: string
  providerKey?: string
  gatewayEnabled?: boolean
} = {}): AppSettingsV1 {
  const provider = defaultModelProviderSettings()
  if (overrides.providerName || overrides.providerKey) {
    provider.providers = [
      {
        ...provider.providers[0],
        id: 'acme',
        name: overrides.providerName ?? 'Acme',
        apiKey: overrides.providerKey ?? ''
      }
    ]
  }
  provider.localGateway = { ...provider.localGateway, enabled: overrides.gatewayEnabled === true }
  return {
    version: 1,
    locale: 'en',
    theme: 'system',
    uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
    composerSendKey: 'enter',
    provider,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        apiKey: overrides.apiKey ?? '',
        model: overrides.model ?? 'kun-fast',
        providerId: overrides.providerName ? 'acme' : defaultKunRuntimeSettings().providerId
      }
    },
    workspaceRoot: '/tmp/workspace',
    conversationWorkspaceRoot: '~/Documents/Kun',
    log: { enabled: false, retentionDays: 7 },
    checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
    notifications: { turnComplete: true },
    appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
    keyboardShortcuts: defaultKeyboardShortcuts(),
    write: defaultWriteSettings(),
    claw: defaultClawSettings(),
    schedule: defaultScheduleSettings(),
    workflow: defaultWorkflowSettings(),
    design: defaultDesignSettings(),
    terminal: defaultTerminalSettings(),
    remote: defaultRemoteAccessSettings(),
    guiUpdate: { channel: 'stable' },
    codePromptPrefix: '',
    chatWelcomeMessage: '',
    codeAgentPresets: [],
    disabledSkillIds: []
  }
}

function row(id: string, transport = 'acp'): AdeHarnessRow {
  return withHarnessReadiness({
    definition: {
      id,
      displayName: id,
      transport: transport as AdeHarnessRow['definition']['transport'],
      credentialModes: ['native-login'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      builtin: false
    },
    status: {
      harnessId: id,
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00.000Z'
    }
  })
}

const base = {
  settings: null,
  rows: [],
  rowsLoaded: false,
  syncStatus: null
}

describe('buildAdeReadinessChecks (P4-14)', () => {
  it('keeps every check pending while sources are still loading', () => {
    const checks = buildAdeReadinessChecks(base)
    expect(checks.map((c) => c.ok)).toEqual([null, null, null])
    expect(checks.map((c) => c.id)).toEqual(['provider', 'agents', 'gateway'])
  })

  it('fails the provider check when no api key or model is configured', () => {
    const checks = buildAdeReadinessChecks({ ...base, settings: settings({ model: '' }) })
    expect(checks[0]).toMatchObject({ id: 'provider', ok: false, section: 'agents' })
  })

  it('reports the active provider name when a key and model exist', () => {
    const checks = buildAdeReadinessChecks({
      ...base,
      settings: settings({ providerName: 'Acme', providerKey: 'sk-x' })
    })
    expect(checks[0]).toMatchObject({ ok: true, detail: 'Acme' })
  })

  it('counts only turn-capable ready harnesses', () => {
    const checks = buildAdeReadinessChecks({
      ...base,
      settings: settings(),
      rows: [row('claude-code'), row('term-x', 'terminal')],
      rowsLoaded: true
    })
    expect(checks[1]).toMatchObject({ id: 'agents', ok: true, detail: '1' })
  })

  it('fails the agents check once the list has loaded empty', () => {
    const checks = buildAdeReadinessChecks({ ...base, settings: settings(), rowsLoaded: true })
    expect(checks[1].ok).toBe(false)
  })

  it('keeps the gateway pending until settings load, then mirrors the toggle', () => {
    const off = buildAdeReadinessChecks({ ...base, settings: settings() })
    expect(off[2]).toMatchObject({ id: 'gateway', ok: false, section: 'providers' })
    const on = buildAdeReadinessChecks({ ...base, settings: settings({ gatewayEnabled: true }) })
    expect(on[2].ok).toBe(true)
  })

  it('marks the gateway failed when the sync status reports a rejected section', () => {
    const syncStatus: KunRuntimeSettingsSyncStatusPayload = {
      state: 'synced',
      generation: 1,
      sections: { localModelGateway: { code: 'gateway_disabled', message: 'x' } },
      at: '2026-01-01T00:00:00.000Z'
    }
    const checks = buildAdeReadinessChecks({
      ...base,
      settings: settings({ gatewayEnabled: true }),
      syncStatus
    })
    expect(checks[2]).toMatchObject({ ok: false, detail: 'gateway_disabled' })
  })
})
