import { describe, expect, it } from 'vitest'
import { sanitizeMemoryDegradedReason } from './hybrid-memory-degraded-state.js'

describe('sanitizeMemoryDegradedReason', () => {
  it('redacts credentials and Windows, UNC, POSIX, and file URL paths', () => {
    const reason = sanitizeMemoryDegradedReason([
      'token=top-secret',
      'D:\\Users\\alice\\Kun\\better_sqlite3.node',
      '\\\\server\\private-share\\memory-index.sqlite3',
      '/home/alice/.config/Kun/memory-index.sqlite3',
      'file:///Users/alice/Kun/memory.db'
    ].join('\n'))

    expect(reason).not.toContain('top-secret')
    expect(reason).not.toContain('Users\\alice')
    expect(reason).not.toContain('private-share')
    expect(reason).not.toContain('/home/alice')
    expect(reason).not.toContain('/Users/alice')
    expect(reason).toContain('token=[redacted]')
    expect(reason).toContain('[local-path]/better_sqlite3.node')
    expect(reason).toContain('[local-path]/memory-index.sqlite3')
  })

  it('keeps actionable module and ABI details within the diagnostics bound', () => {
    const reason = sanitizeMemoryDegradedReason(
      `load failed at D:\\private\\better_sqlite3.node; NODE_MODULE_VERSION 127 requires 148 ${'x'.repeat(600)}`
    )

    expect(reason).toContain('better_sqlite3.node')
    expect(reason).toContain('NODE_MODULE_VERSION 127 requires 148')
    expect(reason.length).toBeLessThanOrEqual(512)
  })
})
