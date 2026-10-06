import { describe, expect, it } from 'vitest'
import { HarnessCatalog } from './harness-catalog.js'
import { harnessTurnPermissionMode } from './harness-turn-permissions.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'

const catalog = new HarnessCatalog()
const full = { approvalPolicy: 'auto' as const, sandboxMode: 'danger-full-access' as const,
  approvalReviewer: 'user' as const, unattended: false, allowUnattendedFullAccess: false }
describe('native permission mapping', () => {
  it('uses the composer full-access grant for Devin and OpenCode', () => {
    expect(harnessTurnPermissionMode(catalog.get('devin')!, full)).toBe('bypass')
    for (const id of ['opencode', 'opencode2']) expect(harnessTurnPermissionMode(catalog.get(id)!, full)).toBe('build')
  })
  it('never raises native defaults above the current host permission or unattended ceiling', () => {
    const def = catalog.get('devin')!
    expect(harnessTurnPermissionMode(def, { ...full, requested: 'bypass', sandboxMode: 'read-only' })).toBe('ask')
    expect(harnessTurnPermissionMode(def, { ...full, requested: 'bypass', approvalPolicy: 'on-request', sandboxMode: 'workspace-write' })).toBe('ask')
    expect(harnessTurnPermissionMode(def, { ...full, unattended: true })).toBe('ask')
    expect(harnessTurnPermissionMode(def, { ...full, unattended: true, allowUnattendedFullAccess: true })).toBe('bypass')
  })
  it('respects explicit narrower native preferences and safely handles legacy values', () => {
    expect(harnessTurnPermissionMode(catalog.get('devin')!, { ...full, requested: 'accept-edits' })).toBe('accept-edits')
    expect(harnessTurnPermissionMode(catalog.get('devin')!, { ...full, requested: 'normal' })).toBe('normal')
    expect(harnessTurnPermissionMode(catalog.get('opencode')!, { ...full, requested: 'plan' })).toBe('plan')
  })
  it('negotiates legacy approval mode only within a writable host scope', () => {
    const def = catalog.get('devin')!
    expect(harnessTurnPermissionMode(def, { ...full, approvalPolicy: 'on-request', sandboxMode: 'workspace-write' })).toBe('normal')
    expect(harnessTurnPermissionMode(def, { ...full, requested: 'normal', sandboxMode: 'read-only' })).toBe('ask')
    expect(harnessTurnPermissionMode(def, { ...full, requested: 'auto', unattended: true })).toBe('ask')
    expect(harnessTurnPermissionMode(def, { ...full, requested: 'ask' })).toBe('ask')
  })
  it('maps the reviewer-approved host scope to Devin Smart and never above it', () => {
    const def = catalog.get('devin')!
    const approveForMe = { ...full, ...kunToolPermissionModeSettings('approve-for-me') }
    expect(harnessTurnPermissionMode(def, approveForMe)).toBe('smart')
    expect(harnessTurnPermissionMode(def, { ...approveForMe, requested: 'bypass' })).not.toBe('bypass')
    expect(harnessTurnPermissionMode(def, { ...full, ...kunToolPermissionModeSettings('ask-for-approval') })).toBe('normal')
  })
  it('never falls back to a wider first entry from a custom Agent', () => {
    const definition = catalog.get('devin')!
    const wideFirst = { ...definition, permissionModes: [...definition.permissionModes].reverse() }
    expect(harnessTurnPermissionMode(wideFirst, { ...full, requested: 'bypass', sandboxMode: 'read-only' })).toBe('ask')
    const onlyFull = { ...definition, permissionModes: definition.permissionModes.filter((mode) => mode.kunPermissionMode === 'full-access') }
    expect(() => harnessTurnPermissionMode(onlyFull, { ...full, sandboxMode: 'read-only' })).toThrow('no permission mode')
  })
  it('keeps read-only and unattended work in the strictest native mode despite equal approval bounds', () => {
    const definition = { ...catalog.get('devin')!, id: 'test-modes', permissionModes: [
      { id: 'plan', label: 'Plan (read-only)', kunPermissionMode: 'ask-for-approval' as const },
      { id: 'default', label: 'Default (writes after approval)', kunPermissionMode: 'ask-for-approval' as const },
      { id: 'bypass', label: 'Bypass', kunPermissionMode: 'full-access' as const }
    ] }
    expect(harnessTurnPermissionMode(definition, { ...full, sandboxMode: 'read-only' })).toBe('plan')
    expect(harnessTurnPermissionMode(definition, { ...full, sandboxMode: 'read-only', requested: 'default' })).toBe('plan')
    expect(harnessTurnPermissionMode(definition, { ...full, unattended: true, requested: 'default' })).toBe('plan')
    expect(harnessTurnPermissionMode(definition, { ...full, approvalPolicy: 'on-request', sandboxMode: 'workspace-write' })).toBe('default')
  })
})
