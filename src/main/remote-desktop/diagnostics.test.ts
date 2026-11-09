import { expect, it } from 'vitest'
import { desktopDiagnosticCode } from './diagnostics'

it('retains known lifecycle causes and strips arbitrary remote or exception text', () => {
  expect(desktopDiagnosticCode(new Error('DESKTOP_CAPTURE_TIMEOUT'))).toBe('DESKTOP_CAPTURE_TIMEOUT')
  expect(desktopDiagnosticCode('lease_or_authority_expired')).toBe('lease_or_authority_expired')
  expect(desktopDiagnosticCode(new Error('private input or TURN password'))).toBe('unknown')
  expect(desktopDiagnosticCode({ reason: 'SCREEN_PERMISSION_REQUIRED' })).toBe('unknown')
})
