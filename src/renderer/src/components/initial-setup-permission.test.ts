import { describe, expect, it } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '@shared/app-settings'
import { kunExecutionSettingsChange } from '../../../main/execution-settings-consent'
import { buildInitialSetupSettingsPatch, initialSetupDrafts } from './initial-setup-save'
import {
  initialSetupPermissionMode,
  initialSetupPermissionPatch,
  withStoredExecutionSettings
} from './initial-setup-permission'

function settings(patch: Record<string, unknown> = {}): AppSettingsV1 {
  return normalizeAppSettings(patch as AppSettingsV1)
}

describe('first-run permission save', () => {
  const stored = settings({ provider: { apiKey: 'sk-deepseek-key' }, locale: 'en', theme: 'system' })

  it('saves language, theme and model without touching the permissions Main guards', () => {
    // The guide edits its local form: a new language and theme plus the
    // full-access card the user clicked.
    const form = settings({
      ...stored,
      locale: 'zh',
      theme: 'dark',
      agents: { kun: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user' } }
    })
    const base = withStoredExecutionSettings(form, stored)
    const patch = buildInitialSetupSettingsPatch(base, initialSetupDrafts(stored), { presetId: 'deepseek', mode: 'api' }, stored)
    expect(patch).toEqual(expect.objectContaining({ locale: 'zh', theme: 'dark' }))
    expect(kunExecutionSettingsChange(stored, patch)).toBeUndefined()
  })

  it('sends the chosen mode on its own, and nothing when it already holds', () => {
    expect(initialSetupPermissionMode(stored)).toBe('ask-for-approval')
    const patch = initialSetupPermissionPatch(stored, { permissionMode: 'full-access', permissionTouched: false })
    expect(patch).toEqual({ agents: { kun: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access' } } })
    expect(kunExecutionSettingsChange(stored, patch!)).toBeDefined()
    expect(initialSetupPermissionPatch(stored, { permissionMode: 'ask-for-approval', permissionTouched: false })).toBeNull()
    expect(initialSetupPermissionPatch(stored, { permissionMode: 'ask-for-approval', permissionTouched: true })).toBeNull()
  })

  it('leaves an untouched legacy combination alone but canonicalizes it once picked', () => {
    const legacy = settings({ agents: { kun: { approvalPolicy: 'never', sandboxMode: 'external-sandbox' } } })
    expect(initialSetupPermissionMode(legacy)).toBe('ask-for-approval')
    expect(initialSetupPermissionPatch(legacy, { permissionMode: 'ask-for-approval', permissionTouched: false })).toBeNull()
    expect(initialSetupPermissionPatch(legacy, { permissionMode: 'ask-for-approval', permissionTouched: true }))
      .toEqual({ agents: { kun: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' } } })
  })
})
