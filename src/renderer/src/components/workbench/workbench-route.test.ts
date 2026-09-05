import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchRoute } from './workbench-route'

describe('normalizeWorkbenchRoute', () => {
  it('projects the legacy standalone Design route through Code', () => {
    expect(normalizeWorkbenchRoute('design')).toBe('chat')
  })

  it.each(['chat', 'write', 'plugins', 'extensions', 'board', 'schedule', 'workflow'])(
    'preserves the active %s route',
    (route) => {
      expect(normalizeWorkbenchRoute(route)).toBe(route)
    }
  )

  it('falls back to chat for an unknown persisted route', () => {
    expect(normalizeWorkbenchRoute('removed-surface')).toBe('chat')
  })
})
