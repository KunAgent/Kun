import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  adeHarnessModelGroups,
  credentialGroupFromKey,
  credentialGroupKey,
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
    expect(credentialGroupFromKey(credentialGroupKey('native-login')))
      .toEqual({ mode: 'native-login', providerId: undefined })
    expect(credentialGroupFromKey(credentialGroupKey('kun-gateway')))
      .toEqual({ mode: 'kun-gateway', providerId: undefined })
    expect(credentialGroupFromKey(credentialGroupKey('provider')))
      .toEqual({ mode: 'provider', providerId: undefined })
  })

  it('carries the provider id in per-provider group keys', () => {
    expect(credentialGroupFromKey('ade-cred:kun-gateway:deepseek'))
      .toEqual({ mode: 'kun-gateway', providerId: 'deepseek' })
    expect(credentialGroupFromKey('ade-cred:provider:stepfun'))
      .toEqual({ mode: 'provider', providerId: 'stepfun' })
    expect(credentialGroupFromKey('ade-cred:kun-gateway:')).toBeNull()
  })

  it('returns null for ordinary provider ids and empty input', () => {
    expect(credentialGroupFromKey('deepseek')).toBeNull()
    expect(credentialGroupFromKey('')).toBeNull()
    expect(credentialGroupFromKey(undefined)).toBeNull()
    expect(credentialGroupFromKey('ade-cred:bogus')).toBeNull()
  })
})

describe('effectiveHarnessId', () => {
  it('mirrors legacy provider-kind inference without overriding explicit Kun', () => {
    expect(effectiveHarnessId('', undefined, 'agent-sdk')).toBe('claude-code')
    expect(effectiveHarnessId('', undefined, 'cursor-sdk')).toBe('cursor')
    expect(effectiveHarnessId('', undefined, 'gemini-cli-api')).toBe('kun')
    expect(effectiveHarnessId('kun', 'claude-code', 'agent-sdk')).toBe('kun')
  })
  it('prefers the composer selection, then the thread binding, then kun', () => {
    expect(effectiveHarnessId('cursor', 'claude-code')).toBe('cursor')
    expect(effectiveHarnessId('', 'claude-code')).toBe('claude-code')
    expect(effectiveHarnessId('  ', '  ')).toBe('kun')
    expect(effectiveHarnessId('', undefined)).toBe('kun')
  })
})

describe('adeHarnessModelGroups', () => {
  const exposable = [
    { providerId: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { providerId: 'stepfun', label: 'StepFun', models: ['step-3'] }
  ]

  it('lists harness models under native login and provider models under gateway groups', () => {
    const groups = adeHarnessModelGroups({
      row: harnessRow(),
      models: ['opus', 'sonnet'],
      providerGroups: exposable,
      labels,
      hasConfiguredProvider: true
    })
    expect(groups.map((group) => group.providerId)).toEqual([
      credentialGroupKey('native-login'),
      `${credentialGroupKey('kun-gateway')}:deepseek`,
      `${credentialGroupKey('kun-gateway')}:stepfun`
    ])
    expect(groups[0]?.modelIds).toEqual(['opus', 'sonnet'])
    expect(groups[1]?.label).toBe('Kun gateway · DeepSeek')
    expect(groups[1]?.modelIds).toEqual(['deepseek-chat', 'deepseek-reasoner'])
  })

  it('drops provider-backed groups when no provider is configured', () => {
    const groups = adeHarnessModelGroups({
      row: harnessRow({ credentialModes: ['native-login', 'provider'] }),
      models: ['opus'],
      providerGroups: exposable,
      labels,
      hasConfiguredProvider: false
    })
    expect(groups.map((group) => group.providerId)).toEqual([credentialGroupKey('native-login')])
  })

  it('emits no provider groups until the exposable catalog arrives', () => {
    const groups = adeHarnessModelGroups({
      row: harnessRow(),
      models: ['opus'],
      providerGroups: [],
      labels,
      hasConfiguredProvider: true
    })
    expect(groups.map((group) => group.providerId)).toEqual([credentialGroupKey('native-login')])
  })

  it('returns no groups for an unknown harness row', () => {
    expect(adeHarnessModelGroups({
      row: undefined,
      models: ['opus'],
      providerGroups: exposable,
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
