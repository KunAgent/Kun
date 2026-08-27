import { describe, expect, it } from 'vitest'
import {
  PACKAGED_UPDATE_HANDOFF_SMOKE_ARG,
  PACKAGED_UPDATE_HANDOFF_SMOKE_FAILED,
  packagedUpdateHandoffSmokeFailure,
  packagedUpdateHandoffSmokeRequested
} from './packaged-update-handoff-smoke'
import { KunHandoffError } from './runtime/kun-installed-build-handoff'

describe('packaged update handoff smoke entry', () => {
  it('requires a packaged app, the isolated desktop marker, the opt-in marker, and the flag', () => {
    const argv = ['Kun', PACKAGED_UPDATE_HANDOFF_SMOKE_ARG]
    const env = {
      KUN_PACKAGED_EXTENSION_DESKTOP_SMOKE: '1',
      KUN_PACKAGED_UPDATE_HANDOFF_SMOKE: '1'
    }
    expect(packagedUpdateHandoffSmokeRequested(argv, env, true)).toBe(true)
    expect(packagedUpdateHandoffSmokeRequested(argv, env, false)).toBe(false)
    expect(packagedUpdateHandoffSmokeRequested(['Kun'], env, true)).toBe(false)
    expect(packagedUpdateHandoffSmokeRequested(argv, {
      KUN_PACKAGED_UPDATE_HANDOFF_SMOKE: '1'
    }, true)).toBe(false)
  })

  it('emits only sanitized typed failure fields', () => {
    const error = new KunHandoffError(
      'runtime_stop_failed',
      'stop-runtimes',
      'in-app-update',
      false,
      {
        kind: 'runtime',
        flavor: 'production',
        instanceId: 'runtime-secret-instance',
        pid: 4321,
        port: 18899,
        buildId: 'a'.repeat(64)
      },
      'secret token and full command must not escape'
    )
    const line = packagedUpdateHandoffSmokeFailure(error)
    expect(line.startsWith(PACKAGED_UPDATE_HANDOFF_SMOKE_FAILED)).toBe(true)
    expect(line).toContain('runtime_stop_failed')
    expect(line).toContain('"buildId":"aaaaaaaaaaaa"')
    expect(line).not.toContain('runtime-secret-instance')
    expect(line).not.toContain('secret token')
    expect(line).not.toContain('full command')
  })
})
