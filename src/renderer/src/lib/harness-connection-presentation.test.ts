import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { harnessConnectionPresentation } from './harness-connection-presentation'

function row(transport: AdeHarnessRow['definition']['transport'], credentials: AdeHarnessRow['definition']['credentialModes']): AdeHarnessRow {
  return {
    definition: { id: 'cursor', displayName: 'Cursor', transport, credentialModes: credentials,
      permissionModes: [], modelSource: 'provider', staticModels: [], builtin: true },
    status: { harnessId: 'cursor', installed: 'yes', login: 'signed-out', reasonCode: 'signed_out', checkedAt: '2026-09-30' }
  }
}

describe('Agent connection presentation', () => {
  it('directs provider-only Cursor SDK errors to model source configuration', () => {
    expect(harnessConnectionPresentation(row('cursor-sdk', ['provider']))).toEqual({
      code: 'signed_out', configureProvider: true, labelKey: 'adeProviderSelectionRequired', nextStepKey: null
    })
  })

  it('retains CLI login guidance for native-login transports', () => {
    expect(harnessConnectionPresentation(row('acp', ['native-login']))).toMatchObject({
      configureProvider: false, labelKey: 'adeHarnessUnavailable.signedOut', nextStepKey: 'adeHarnessNextStep.login'
    })
  })
})
