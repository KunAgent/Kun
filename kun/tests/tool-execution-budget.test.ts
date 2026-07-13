import { describe, expect, it } from 'vitest'
import { ToolExecutionBudget } from '../src/contracts/tool-execution-budget.js'

describe('ToolExecutionBudget', () => {
  it('defaults network access to none', () => {
    expect(ToolExecutionBudget.parse({
      timeoutMs: 30_000,
      maxOutputBytes: 512 * 1024
    })).toEqual({
      timeoutMs: 30_000,
      maxOutputBytes: 512 * 1024,
      networkPolicy: 'none'
    })
  })

  it('accepts bounded process, memory, and CPU limits', () => {
    expect(ToolExecutionBudget.parse({
      timeoutMs: 60_000,
      maxOutputBytes: 1_024 * 1_024,
      maxProcesses: 4,
      maxMemoryBytes: 512 * 1_024 * 1_024,
      maxCpuTimeMs: 45_000,
      networkPolicy: 'approved'
    }).networkPolicy).toBe('approved')
  })

  it('rejects unsafe or ambiguous budgets', () => {
    expect(() => ToolExecutionBudget.parse({ timeoutMs: 0, maxOutputBytes: 1 })).toThrow()
    expect(() => ToolExecutionBudget.parse({ timeoutMs: 1, maxOutputBytes: 65 * 1024 * 1024 })).toThrow()
    expect(() => ToolExecutionBudget.parse({ timeoutMs: 1, maxOutputBytes: 1, networkPolicy: 'lan' })).toThrow()
    expect(() => ToolExecutionBudget.parse({ timeoutMs: 1, maxOutputBytes: 1, extra: true })).toThrow()
  })
})
