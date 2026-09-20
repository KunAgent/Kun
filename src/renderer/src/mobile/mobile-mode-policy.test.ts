import { describe, expect, it } from 'vitest'
import { modeForWorkbenchRoute, workbenchRouteForMode, workLeaveDecision } from './mobile-mode-policy'

describe('mobile mode policy', () => {
  it.each([
    ['chat', 'code'], ['design', 'code'], ['workflow', 'code'],
    ['rooms', 'rooms'], ['write', 'work']
  ] as const)('maps workbench route %s to %s', (route, mode) => {
    expect(modeForWorkbenchRoute(route)).toBe(mode)
  })

  it.each([
    ['code', 'chat'], ['rooms', 'rooms'], ['work', 'write']
  ] as const)('maps mobile mode %s to internal route %s', (mode, route) => {
    expect(workbenchRouteForMode(mode)).toBe(route)
  })

  it('blocks mode changes until Work save and review state is safe', () => {
    expect(workLeaveDecision({ saveStatus: 'saved', conflict: false, reviewActive: false })).toBe('allow')
    expect(workLeaveDecision({ saveStatus: 'idle', conflict: false, reviewActive: false })).toBe('allow')
    expect(workLeaveDecision({ saveStatus: 'saving', conflict: false, reviewActive: false })).toBe('wait')
    expect(workLeaveDecision({ saveStatus: 'dirty', conflict: false, reviewActive: false })).toBe('confirm-discard')
    expect(workLeaveDecision({ saveStatus: 'error', conflict: false, reviewActive: false })).toBe('confirm-discard')
    expect(workLeaveDecision({ saveStatus: 'saved', conflict: false, reviewActive: true })).toBe('confirm-discard')
    expect(workLeaveDecision({ saveStatus: 'saving', conflict: true, reviewActive: false })).toBe('resolve-conflict')
  })
})
