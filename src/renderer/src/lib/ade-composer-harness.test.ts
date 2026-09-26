import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  adeHarnessModelGroups,
  credentialGroupKey,
  credentialModeFromGroupKey,
  defaultCredentialModeForRow,
  effectiveHarnessId,
  harnessSlashCommandText,
  harnessSwitchNeedsConfirmation
} from './ade-composer-harness'

const labels = {
  nativeLogin: 'Native sign-in',
  provider: 'Provider',
  kunGateway: 'Kun gateway'
}

function harnessRow(overrides?: {
  id?: string
  credentialModes?: Array<'native-login' | 'provider' | 'kun-gateway'>
}): AdeHarnessRow {
  return {
    definition: {
      id: overrides?.id ?? 'claude-code',
      displayName: 'Claude Code',
      transport: 'agent-sdk',
      credentialModes: overrides?.credentialModes ?? ['native-login', 'kun-gateway'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: ['claude-opus-4'],
      builtin: false
    },
    status: {
      harnessId: overrides?.id ?? 'claude-code',
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00Z'
    }
  }
}

describe('credential group key codec', () => {
  it('round-trips credential modes through sentinel group keys', () => {
    expect(credentialModeFromGroupKey(credentialGroupKey('native-login'))).toBe('native-login')
    expect(credentialModeFromGroupKey(credentialGroupKey('kun-gateway'))).toBe('kun-gateway')
    expect(credentialModeFromGroupKey(credentialGroupKey('provider'))).toBe('provider')
  })

  it('returns null for ordinary provider ids and empty input', () => {
    expect(credentialModeFromGroupKey('deepseek')).toBeNull()
    expect(credentialModeFromGroupKey('')).toBeNull()
    expect(credentialModeFromGroupKey(undefined)).toBeNull()
    expect(credentialModeFromGroupKey('ade-cred:bogus')).toBeNull()
  })
})

describe('effectiveHarnessId', () => {
  it('prefers the composer selection, then the thread binding, then kun', () => {
    expect(effectiveHarnessId('cursor', 'claude-code')).toBe('cursor')
    expect(effectiveHarnessId('', 'claude-code')).toBe('claude-code')
    expect(effectiveHarnessId('  ', '  ')).toBe('kun')
    expect(effectiveHarnessId('', undefined)).toBe('kun')
  })
})

describe('adeHarnessModelGroups', () => {
  it('groups the harness model list by declared credential modes', () => {
    const groups = adeHarnessModelGroups({
      row: harnessRow(),
      models: ['opus', 'sonnet'],
      labels,
      hasConfiguredProvider: true
    })
    expect(groups.map((group) => group.providerId)).toEqual([
      credentialGroupKey('native-login'),
      credentialGroupKey('kun-gateway')
    ])
    expect(groups[0]?.modelIds).toEqual(['opus', 'sonnet'])
    expect(groups[1]?.label).toBe('Kun gateway')
  })

  it('drops provider-backed groups when no provider is configured', () => {
    const groups = adeHarnessModelGroups({
      row: harnessRow({ credentialModes: ['native-login', 'provider'] }),
      models: ['opus'],
      labels,
      hasConfiguredProvider: false
    })
    expect(groups.map((group) => group.providerId)).toEqual([credentialGroupKey('native-login')])
  })

  it('returns no groups for an unknown harness row', () => {
    expect(adeHarnessModelGroups({
      row: undefined,
      models: ['opus'],
      labels,
      hasConfiguredProvider: true
    })).toEqual([])
  })
})

describe('defaultCredentialModeForRow', () => {
  it('uses the first declared credential mode', () => {
    expect(defaultCredentialModeForRow(harnessRow())).toBe('native-login')
    expect(defaultCredentialModeForRow(undefined)).toBe('')
  })
})

describe('harnessSwitchNeedsConfirmation', () => {
  it('only prompts when switching to a different harness mid-conversation', () => {
    expect(harnessSwitchNeedsConfirmation({
      threadHasUserMessages: true,
      currentHarnessId: 'kun',
      nextHarnessId: 'claude-code'
    })).toBe(true)
    expect(harnessSwitchNeedsConfirmation({
      threadHasUserMessages: false,
      currentHarnessId: 'kun',
      nextHarnessId: 'claude-code'
    })).toBe(false)
    expect(harnessSwitchNeedsConfirmation({
      threadHasUserMessages: true,
      currentHarnessId: 'claude-code',
      nextHarnessId: 'claude-code'
    })).toBe(false)
  })

  it('treats empty as kun on both sides', () => {
    expect(harnessSwitchNeedsConfirmation({
      threadHasUserMessages: true,
      currentHarnessId: '',
      nextHarnessId: 'kun'
    })).toBe(false)
  })
})

describe('harnessSlashCommandText', () => {
  it('normalizes command names to leading-slash text', () => {
    expect(harnessSlashCommandText({ name: 'review' })).toBe('/review')
    expect(harnessSlashCommandText({ name: '/compact' })).toBe('/compact')
    expect(harnessSlashCommandText({ name: '  login  ' })).toBe('/login')
  })
})
