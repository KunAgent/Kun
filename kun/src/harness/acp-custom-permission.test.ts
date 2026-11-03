import { describe, expect, it, vi } from 'vitest'
import { HarnessDefaultsEntrySchema } from '../config/kun-config-harnesses.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import { HarnessCatalog } from './harness-catalog.js'
import { harnessTurnPermissionMode } from './harness-turn-permissions.js'
import { resolvePermissionMode } from './harness-admission.js'
import { acpLaunchArgs } from './acp-launch-args.js'
import { readinessFingerprint } from './harness-readiness-profile.js'
import { providerModule } from './providers/registry.js'
import { applyAcpProviderPermission } from '../runtime/acp/acp-provider-permissions.js'
import type { AcpConnection } from '../runtime/acp/acp-connection.js'
import type { AcpConfigOption } from '../runtime/acp/acp-schema.js'

const catalog = new HarnessCatalog({ custom: () => [] })
const qoder = catalog.get('qoder')!
const permission = (mode: string, level: 'ask-for-approval' | 'approve-for-me' | 'full-access', unattended = false, allow = false) =>
  harnessTurnPermissionMode(qoder, { requested: mode, ...kunToolPermissionModeSettings(level), unattended, allowUnattendedFullAccess: allow })
const option = (value: string): AcpConfigOption => ({ id: 'mode', category: 'mode', name: 'Mode', type: 'select',
  currentValue: value, options: ['default', 'new-mode'].map(value => ({ value, name: value })) })

describe('custom ACP mode preference', () => {
  it('normalizes blanks and whitespace without truncating or accepting controls', () => {
    expect(HarnessDefaultsEntrySchema.parse({ permissionMode: '  new-mode  ' }).permissionMode).toBe('new-mode')
    expect(HarnessDefaultsEntrySchema.parse({ permissionMode: '   ' }).permissionMode).toBeUndefined()
    for (const value of ['a'.repeat(65), 'x\ny', '\tyolo', 'x\u007f']) {
      expect(HarnessDefaultsEntrySchema.safeParse({ permissionMode: value }).success).toBe(false)
    }
    expect(HarnessDefaultsEntrySchema.parse({ permissionMode: 'a'.repeat(64) }).permissionMode).toHaveLength(64)
  })
  it('preserves custom values only under full access, including unattended restrictions', () => {
    expect(permission(' new-mode ', 'full-access')).toBe('new-mode')
    expect(permission('new-mode', 'full-access', true, true)).toBe('new-mode')
    for (const level of ['ask-for-approval', 'approve-for-me'] as const) {
      expect(() => permission('new-mode', level)).toThrow('Full access')
    }
    expect(() => permission('new-mode', 'full-access', true)).toThrow('Full access')
    expect(() => harnessTurnPermissionMode(qoder, { requested: 'new-mode', sandboxMode: 'read-only',
      unattended: false, allowUnattendedFullAccess: true })).toThrow('Full access')
    expect(() => resolvePermissionMode(qoder, 'new-mode', true, false)).toThrow('unattended')
    expect(resolvePermissionMode(qoder, 'new-mode', false, false)).toBe('new-mode')
    expect(resolvePermissionMode(catalog.get('codex')!, 'new-mode', false, false)).toBe(catalog.get('codex')!.permissionModes[0].id)
    expect(permission('bypass_permissions', 'ask-for-approval')).toBe('default')
  })
  it('passes Qoder custom modes as one argv value and maps the verified yolo startup alias', () => {
    expect(acpLaunchArgs(qoder, permission('yolo', 'full-access'))).toEqual(['--acp', '--permission-mode', 'bypass_permissions'])
    expect(acpLaunchArgs(qoder, permission('bad-mode', 'full-access'))).toEqual(['--acp', '--permission-mode', 'bad-mode'])
    expect(acpLaunchArgs(qoder, 'mode with spaces; echo test').at(-1)).toBe('mode with spaces; echo test')
  })
  it('invalidates readiness when the saved mode changes', () => {
    const route = { harnessId: 'qoder', model: 'default', credentialMode: 'native-login' as const }
    const fingerprint = (permissionMode: string) => readinessFingerprint({ definition: qoder, route, secretEnv: {},
      options: { harnesses: { defaults: { qoder: { permissionMode } } } as never } })
    expect(fingerprint('new-mode')).not.toBe(fingerprint('other-mode'))
  })
  it.each(['qoder', 'devin', 'copilot'])('requires exact custom mode evidence for %s, without provider fallbacks', async id => {
    const request = vi.fn().mockResolvedValue({ configOptions: [option('new-mode')] })
    const conn = { rpc: { request } } as unknown as AcpConnection
    const module = providerModule(id)!
    const session = { sessionId: 's', configOptions: [option('default')] }
    await applyAcpProviderPermission(conn, session, 'new-mode', module, module.definition.acpPermission)
    expect(request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 's', configId: 'mode', value: 'new-mode' })
    request.mockClear()
    await expect(applyAcpProviderPermission(conn, { sessionId: 's' }, 'new-mode', module, module.definition.acpPermission))
      .rejects.toMatchObject({ code: 'policy_denied' })
    await expect(applyAcpProviderPermission(conn, { sessionId: 's', configOptions: [option('default')] }, 'unknown', module, module.definition.acpPermission))
      .rejects.toThrow("it offers 'default', 'new-mode'")
    expect(request).not.toHaveBeenCalled()
    request.mockResolvedValueOnce({ configOptions: [option('default')] })
    await expect(applyAcpProviderPermission(conn, { sessionId: 's', configOptions: [option('default')] }, 'new-mode', module))
      .rejects.toMatchObject({ code: 'policy_denied' })
  })
})
