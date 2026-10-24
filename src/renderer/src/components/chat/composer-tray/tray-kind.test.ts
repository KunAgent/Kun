import { describe, expect, it } from 'vitest'
import { resolveTrayKinds, TRAY_KIND_ORDER, type TrayKind, type TrayKindId } from './tray-kind'

function kind(id: TrayKindId, align: TrayKind['align'] = 'start'): TrayKind {
  return {
    id,
    align,
    tone: 'default',
    ariaLabel: id,
    renderSegment: () => id,
    renderSheet: null
  }
}

describe('resolveTrayKinds', () => {
  it('drops empty slots and orders start kinds before trailing kinds', () => {
    const resolved = resolveTrayKinds([
      kind('goal', 'end'),
      null,
      kind('shells'),
      undefined,
      kind('todo'),
      kind('graph')
    ])
    expect(resolved.map((item) => item.id)).toEqual(['graph', 'todo', 'shells', 'goal'])
  })

  it('hides Dispatch while Workers is present', () => {
    expect(resolveTrayKinds([kind('dispatch'), kind('workers')]).map((item) => item.id))
      .toEqual(['workers'])
    expect(resolveTrayKinds([kind('dispatch'), kind('todo')]).map((item) => item.id))
      .toEqual(['todo', 'dispatch'])
  })

  it('keeps the canonical order inside the trailing group', () => {
    const resolved = resolveTrayKinds([kind('goal', 'end'), kind('shells', 'end'), kind('todo')])
    expect(resolved.map((item) => item.id)).toEqual(['todo', 'shells', 'goal'])
    expect(TRAY_KIND_ORDER).toEqual(['graph', 'todo', 'workers', 'dispatch', 'shells', 'goal'])
  })
})
