import { describe, expect, it } from 'vitest'
import type { AppSettingsV1 } from '@shared/app-settings'
import {
  harnessDefaultsFromApp,
  harnessPermissionDefault,
  harnessDefaultsSnapshot,
  harnessCatalogSettingsFingerprint
} from './harness-defaults'

const settingsWith = (harnesses: unknown): AppSettingsV1 =>
  ({ agents: { kun: { harnesses } } }) as unknown as AppSettingsV1

describe('harnessDefaultsFromApp', () => {
  it('ignores display/workspace settings but notices Agent and provider changes', () => {
    const initial = settingsWith({ enabledProfiles: [{ harnessId: 'devin', credentialMode: 'native-login' }] })
    const key = harnessCatalogSettingsFingerprint(initial)
    expect(harnessCatalogSettingsFingerprint({ ...initial, theme: 'dark', workspaceRoot: '/new', uiFontScale: 1.1 } as AppSettingsV1)).toBe(key)
    expect(harnessCatalogSettingsFingerprint(settingsWith({ enabledProfiles: [] }))).not.toBe(key)
    expect(harnessCatalogSettingsFingerprint({ ...initial, provider: { baseUrl: 'https://example.com' } } as AppSettingsV1)).not.toBe(key)
  })
  it('returns normalized defaults including folded legacy permission modes', () => {
    const settings = settingsWith({
      defaults: { codex: { model: 'gpt-5.4', isolation: 'local' } },
      defaultPermissionMode: { codex: 'auto', 'claude-code': 'acceptEdits' }
    })
    expect(harnessDefaultsFromApp(settings)).toEqual({
      codex: { model: 'gpt-5.4', isolation: 'local', permissionMode: 'auto' },
      'claude-code': { permissionMode: 'acceptEdits' }
    })
  })

  it('returns an empty map when nothing is configured', () => {
    expect(harnessDefaultsFromApp(settingsWith(undefined))).toEqual({})
  })
})

describe('harnessPermissionDefault', () => {
  const definition = {
    permissionModes: [
      { id: 'acceptEdits', label: 'Accept edits', kunPermissionMode: 'full-access' },
      { id: 'plan', label: 'Plan', kunPermissionMode: 'ask-for-approval' }
    ]
  }

  it('maps a declared harness level to the Kun execution-settings triple', () => {
    expect(harnessPermissionDefault(definition, { permissionMode: 'acceptEdits' }))
      .toEqual({
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        approvalReviewer: 'user'
      })
  })

  it('ignores a permission id the harness does not declare', () => {
    expect(harnessPermissionDefault(definition, { permissionMode: 'yolo' }))
      .toBeUndefined()
    expect(harnessPermissionDefault(definition, undefined)).toBeUndefined()
    expect(harnessPermissionDefault(undefined, { permissionMode: 'plan' }))
      .toBeUndefined()
  })
})

describe('harnessDefaultsSnapshot', () => {
  it('starts empty before the settings bridge resolves', () => {
    expect(harnessDefaultsSnapshot()).toEqual({})
  })
})
