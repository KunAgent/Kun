import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings, mergeKunLabSettings } from './app-settings-kun-merge'
import { kunLabPatchSchema } from '../main/ipc/app-ipc-schemas/settings-lab'

describe('Codex reference branch laboratory settings', () => {
  it('defaults off for new and legacy settings', () => {
    expect(defaultKunLabSettings().codexReferenceBranches.enabled).toBe(false)
    expect(mergeKunLabSettings(undefined, undefined).codexReferenceBranches.enabled).toBe(false)
    const legacy = { ...defaultKunLabSettings() }
    delete (legacy as Partial<typeof legacy>).codexReferenceBranches
    expect(mergeKunLabSettings(legacy, undefined).codexReferenceBranches.enabled).toBe(false)
  })
  it('preserves enabled state across unrelated patches and accepts explicit disable', () => {
    const enabled = mergeKunLabSettings(undefined, { codexReferenceBranches: { enabled: true } })
    expect(mergeKunLabSettings(enabled, { projectBoard: { enabled: true } }).codexReferenceBranches.enabled).toBe(true)
    expect(mergeKunLabSettings(enabled, { codexReferenceBranches: { enabled: false } }).codexReferenceBranches.enabled).toBe(false)
  })
  it('validates boolean settings without granting unknown fields', () => {
    expect(kunLabPatchSchema.safeParse({ codexReferenceBranches: { enabled: true } }).success).toBe(true)
    expect(kunLabPatchSchema.safeParse({ codexReferenceBranches: { enabled: 'yes' } }).success).toBe(false)
    expect(kunLabPatchSchema.safeParse({ codexReferenceBranches: { readAll: true } }).success).toBe(false)
  })
})
