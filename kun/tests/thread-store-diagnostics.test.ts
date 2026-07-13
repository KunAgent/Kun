import { describe, expect, it } from 'vitest'
import {
  ThreadStoreDiagnostic,
  ThreadStoreDiagnosticReport
} from '../src/contracts/thread-store-diagnostics.js'

const diagnostic = {
  threadId: 'thr_demo',
  metadata: 'ok' as const,
  events: 'truncated' as const,
  sqliteIndex: 'missing' as const,
  attachments: 'ok' as const,
  recoverable: true,
  issues: [
    {
      code: 'truncated_events',
      message: 'The event log ends with an incomplete JSONL record.',
      severity: 'warning' as const
    }
  ],
  checkedAt: '2026-07-14T12:00:00.000Z'
}

describe('ThreadStoreDiagnostic contract', () => {
  it('accepts a bounded per-thread diagnostic', () => {
    expect(ThreadStoreDiagnostic.parse(diagnostic)).toEqual(diagnostic)
  })

  it('accepts an empty report and preserves the schema version', () => {
    const report = {
      schemaVersion: 1 as const,
      checkedAt: '2026-07-14T12:00:00.000Z',
      threads: []
    }

    expect(ThreadStoreDiagnosticReport.parse(report)).toEqual(report)
  })

  it('rejects unknown artifact states and non-ISO timestamps', () => {
    expect(() => ThreadStoreDiagnostic.parse({ ...diagnostic, events: 'corrupt' })).toThrow()
    expect(() => ThreadStoreDiagnostic.parse({ ...diagnostic, checkedAt: 'yesterday' })).toThrow()
  })

  it('rejects extra fields so the diagnostic contract stays stable', () => {
    expect(() => ThreadStoreDiagnostic.parse({ ...diagnostic, absolutePath: 'C:\\secret' })).toThrow()
  })
})
