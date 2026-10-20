import { describe, expect, it } from 'vitest'
import { resolveSharedRuntimeStartTimeoutMs } from './shared-runtime-start-timeout.js'

describe('resolveSharedRuntimeStartTimeoutMs', () => {
  it('defaults past large-history restart recovery', () => {
    expect(resolveSharedRuntimeStartTimeoutMs({}, 'darwin')).toBe(180_000)
    expect(resolveSharedRuntimeStartTimeoutMs({}, 'win32')).toBe(240_000)
  })

  it('honors KUN_STARTUP_TIMEOUT_MS within the 15s-10min clamp', () => {
    expect(resolveSharedRuntimeStartTimeoutMs({ KUN_STARTUP_TIMEOUT_MS: '90000' }, 'darwin')).toBe(90_000)
    expect(resolveSharedRuntimeStartTimeoutMs({ KUN_STARTUP_TIMEOUT_MS: '10' }, 'darwin')).toBe(15_000)
    expect(resolveSharedRuntimeStartTimeoutMs({ KUN_STARTUP_TIMEOUT_MS: '99999999' }, 'darwin')).toBe(600_000)
    expect(resolveSharedRuntimeStartTimeoutMs({ KUN_STARTUP_TIMEOUT_MS: 'soon' }, 'darwin')).toBe(180_000)
    expect(resolveSharedRuntimeStartTimeoutMs({ KUN_STARTUP_TIMEOUT_MS: ' ' }, 'darwin')).toBe(180_000)
  })
})
