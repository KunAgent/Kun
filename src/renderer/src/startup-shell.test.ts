import { describe, expect, it, vi } from 'vitest'
import {
  mergeStartupPhase,
  startupPhaseLabel,
  startupShellAllowsWorkbench
} from './startup-shell'

describe('desktop startup shell policy', () => {
  it('allows the workbench only after the ready phase', () => {
    expect(startupShellAllowsWorkbench('bootstrapping')).toBe(false)
    expect(startupShellAllowsWorkbench('runtime_handoff')).toBe(false)
    expect(startupShellAllowsWorkbench('runtime_starting')).toBe(false)
    expect(startupShellAllowsWorkbench('recovery_required')).toBe(false)
    expect(startupShellAllowsWorkbench('ready')).toBe(true)
  })

  it('merges phases monotonically and keeps terminal phases terminal', () => {
    expect(mergeStartupPhase('runtime_starting', 'bootstrapping')).toBe('runtime_starting')
    expect(mergeStartupPhase('runtime_handoff', 'runtime_starting')).toBe('runtime_starting')
    expect(mergeStartupPhase('ready', 'runtime_starting')).toBe('ready')
    expect(mergeStartupPhase('recovery_required', 'ready')).toBe('recovery_required')
  })

  it('uses actionable but non-sensitive phase labels', () => {
    expect(startupPhaseLabel('runtime_handoff')).toContain('runtime')
    expect(startupPhaseLabel('recovery_required')).toContain('recovery')
    expect(JSON.stringify(startupPhaseLabel('runtime_handoff'))).not.toContain('/Users/')
  })
})
