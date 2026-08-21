import { describe, expect, it } from 'vitest'
import {
  terminalSessionIdForWorkspace,
  terminalWorkspaceSessionKey
} from './terminal-session'

describe('terminal session ids', () => {
  it('separates the same tab id across workspaces', () => {
    const first = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main')
    const second = terminalSessionIdForWorkspace('/Users/zxy/project-b', 'main')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^terminal:[a-z0-9]+:main$/)
    expect(second).toMatch(/^terminal:[a-z0-9]+:main$/)
  })

  it('separates local and SSH targets without changing local ids', () => {
    const local = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main')
    const firstHost = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main', {
      kind: 'ssh', hostId: 'host-one', hostName: 'One'
    })
    const secondHost = terminalSessionIdForWorkspace('/Users/zxy/project-a', 'main', {
      kind: 'ssh', hostId: 'host-two', hostName: 'Two'
    })

    expect(local).toMatch(/^terminal:[a-z0-9]+:main$/)
    expect(firstHost).toMatch(/^terminal:[a-z0-9]+:ssh-[a-z0-9]+:main$/)
    expect(new Set([local, firstHost, secondHost])).toHaveLength(3)
  })

  it('keeps equivalent workspace paths on the same terminal namespace', () => {
    expect(terminalWorkspaceSessionKey('/Users/zxy/project-a/')).toBe(
      terminalWorkspaceSessionKey('/users/zxy/project-a')
    )
  })

  it('keeps session ids short for very long workspace paths', () => {
    const longWorkspace = `/Users/zxy/${'nested/'.repeat(80)}project`
    const sessionId = terminalSessionIdForWorkspace(longWorkspace, 'tab-1')

    expect(sessionId.length).toBeLessThan(80)
  })
})
