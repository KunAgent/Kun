import { describe, expect, it } from 'vitest'
import { defaultKunLabSettings, mergeKunLabSettings } from './app-settings-kun-merge'
import { kunLabPatchSchema } from '../main/ipc/app-ipc-schemas/settings-lab'

describe('Codex reference branch laboratory settings', () => {
  it('keeps OpenCode off by default and independent from both other sources', () => {
    expect(defaultKunLabSettings().opencodeReferenceBranches.enabled).toBe(false)
    const settings = mergeKunLabSettings(undefined, { opencodeReferenceBranches: { enabled: true } })
    expect(settings.codexReferenceBranches.enabled).toBe(false)
    expect(settings.claudeCodeReferenceBranches.enabled).toBe(false)
    expect(mergeKunLabSettings(settings, { codexReferenceBranches: { enabled: false } }).opencodeReferenceBranches.enabled).toBe(true)
    expect(kunLabPatchSchema.safeParse({ opencodeReferenceBranches: { enabled: true } }).success).toBe(true)
    expect(kunLabPatchSchema.safeParse({ opencodeReferenceBranches: { enabled: 'yes' } }).success).toBe(false)
  })
  it('keeps the two source settings independent and Claude Code off by default', () => {
    expect(defaultKunLabSettings().claudeCodeReferenceBranches.enabled).toBe(false)
    const enabled = mergeKunLabSettings(undefined, { claudeCodeReferenceBranches: { enabled: true } })
    expect(enabled.codexReferenceBranches.enabled).toBe(false)
    expect(enabled.claudeCodeReferenceBranches.enabled).toBe(true)
    expect(mergeKunLabSettings(enabled, { codexReferenceBranches: { enabled: false } }).claudeCodeReferenceBranches.enabled).toBe(true)
    expect(kunLabPatchSchema.safeParse({ claudeCodeReferenceBranches: { enabled: true } }).success).toBe(true)
    expect(kunLabPatchSchema.safeParse({ claudeCodeReferenceBranches: { enabled: 'yes' } }).success).toBe(false)
  })
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
