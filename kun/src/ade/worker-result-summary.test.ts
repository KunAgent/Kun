import { describe, expect, it } from 'vitest'
import { WorkerNoticeSchema } from '../contracts/ade.js'
import { clipWorkerResult, workerResultSummary } from './worker-result-summary.js'

const report = {
  summary: 'Fixed the preview renderer.', outcome: 'partial' as const, submittedAt: '2026-10-30T00:00:00Z',
  checks: [
    { name: 'unit tests', status: 'passed' as const },
    { name: 'build', status: 'failed' as const, detail: 'Missing dependency' },
    { name: 'packaged UI', status: 'skipped' as const, detail: 'Not exercised' }
  ],
  risks: ['Packaged app still needs verification.']
}

describe('worker result summary', () => {
  it('preserves structured findings, check evidence and risks instead of a stale excerpt', () => {
    const text = workerResultSummary({ state: 'completed', workerReport: report, resultExcerpt: 'Old output' })!
    expect(text).toContain('Fixed the preview renderer.')
    expect(text).toContain('Worker-reported outcome: partial')
    expect(text).toContain('1 failed, 1 skipped, 1 passed')
    expect(text).toContain('[failed] build: Missing dependency')
    expect(text).toContain('[skipped] packaged UI: Not exercised')
    expect(text).toContain(report.risks[0])
    expect(text.indexOf('[failed]')).toBeLessThan(text.indexOf('[passed]'))
    expect(text).not.toContain('Old output')
  })

  it('keeps failed checks and risks even with a maximal summary and many passing checks', () => {
    const text = workerResultSummary({ state: 'failed', failureReason: 'Budget exceeded. '.repeat(300),
      workerReport: { ...report, summary: 'Conclusion: '.repeat(360),
        checks: [...Array.from({ length: 60 }, (_, i) => ({ name: `unit-${i}`, status: 'passed' as const, detail: 'x'.repeat(2_000) })),
          ...report.checks], risks: ['Risk: '.repeat(400)] } })!
    expect(text.length).toBeLessThanOrEqual(4_000)
    expect(text).toContain('[failed] build: Missing dependency')
    expect(text).toContain('[skipped] packaged UI: Not exercised')
    expect(text).toContain('Worker-reported risks:\nRisk:')
    expect(text).toContain('[truncated]')
    expect(WorkerNoticeSchema.shape.detail.safeParse(text).success).toBe(true)
  })

  it('keeps the failure reason before the final output and never infers success', () => {
    expect(workerResultSummary({ state: 'failed', failureReason: 'Budget exceeded', resultExcerpt: 'Investigated preview' }))
      .toBe('Budget exceeded\n\nLast worker output: Investigated preview')
    expect(workerResultSummary({ state: 'completed', resultExcerpt: ' Found a bug ' })).toBe('Found a bug')
    expect(workerResultSummary({ state: 'completed', resultExcerpt: '   ' })).toBeUndefined()
  })

  it('keeps the opening conclusion and explicitly marks truncation', () => {
    const text = clipWorkerResult(`Conclusion: fixed\n${'detail '.repeat(400)}END`, 1_500)
    expect(text.startsWith('Conclusion: fixed')).toBe(true)
    expect(text.endsWith('[truncated]')).toBe(true)
    expect(text.length).toBeLessThanOrEqual(1_500)
    expect(text).not.toContain('END')
    expect(clipWorkerResult('short result', 1_500)).toBe('short result')
  })
})
