import { describe, expect, it, vi } from 'vitest'
import { ManagedChildProcessRegistry } from '../services/managed-child-process-registry'
import { registerTerminalProcess, terminalProcessRecord } from './terminal-pty-ipc'

describe('terminalProcessRecord', () => {
  it('uses a namespaced owner identity and safe default cleanup policy', () => {
    expect(terminalProcessRecord('session_1', 4321, '2026-07-14T00:00:00.000Z')).toEqual({
      id: 'terminal:session_1',
      ownerKind: 'terminal',
      ownerId: 'session_1',
      pid: 4321,
      startedAt: '2026-07-14T00:00:00.000Z',
      detached: false,
      cleanupPolicy: 'terminate-tree'
    })
  })

  it('does not depend on wall-clock mocking when a timestamp is supplied', () => {
    const now = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-07-14T01:02:03.000Z')
    try {
      expect(terminalProcessRecord('session_2', 4322).startedAt).toBe('2026-07-14T01:02:03.000Z')
    } finally {
      now.mockRestore()
    }
  })

  it('registers the terminal lifecycle in the shared registry', () => {
    const registry = new ManagedChildProcessRegistry()
    const processId = registerTerminalProcess(
      registry,
      'session_3',
      4323,
      '2026-07-14T02:03:04.000Z'
    )

    expect(registry.get(processId)).toMatchObject({
      id: 'terminal:session_3',
      ownerKind: 'terminal',
      ownerId: 'session_3',
      pid: 4323
    })
    expect(registry.remove(processId)).toBe(true)
    expect(registry.get(processId)).toBeUndefined()
  })
})
