import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildSidebarWorkspaceGroups } from './sidebar-project-selectors'
import { workspaceRootIdentityKey } from '../../lib/workspace-path'
import {
  sidebarWorkspaceCreationTimesFromEntries,
  sidebarWorkspaceCreationTimesKey
} from './sidebar-project-creation-times'
import { firstSeenTimesFor } from './sidebar-project-first-seen'

function createMemoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => items.delete(key),
    setItem: (key, value) => items.set(key, value)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function groupPaths(
  workspaceRoots: string[],
  workspaceCreatedAt?: Record<string, number>,
  workspaceRoot = ''
): string[] {
  return buildSidebarWorkspaceGroups({
    threads: [],
    searchQuery: '',
    showArchived: false,
    workspaceRoot,
    workspaceRoots,
    conversationRoot: '',
    workspaceCreatedAt
  }).map(([workspacePath]) => workspacePath)
}

describe('buildSidebarWorkspaceGroups creation-time ordering', () => {
  it('sorts projects newest-first by folder creation time', () => {
    const roots = ['D:/kun', 'D:/skill', 'D:/zhihu']
    const createdAt = {
      [workspaceRootIdentityKey('D:/kun')]: 1000,
      [workspaceRootIdentityKey('D:/skill')]: 2000,
      [workspaceRootIdentityKey('D:/zhihu')]: 3000
    }
    expect(groupPaths(roots, createdAt)).toEqual(['D:/zhihu', 'D:/skill', 'D:/kun'])
  })

  it('matches creation times case-insensitively against display paths', () => {
    const roots = ['D:/Apps/ZhiHu', 'D:/apps/alpha']
    const createdAt = {
      [workspaceRootIdentityKey('d:/apps/zhihu')]: 2000,
      [workspaceRootIdentityKey('D:/apps/alpha')]: 1000
    }
    expect(groupPaths(roots, createdAt)).toEqual(['D:/Apps/ZhiHu', 'D:/apps/alpha'])
  })

  it('sinks undated projects below dated ones and keeps name order among them', () => {
    const roots = ['D:/zzz-undated', 'D:/dated', 'D:/aaa-undated']
    const createdAt = { [workspaceRootIdentityKey('D:/dated')]: 1000 }
    expect(groupPaths(roots, createdAt)).toEqual(['D:/dated', 'D:/aaa-undated', 'D:/zzz-undated'])
  })

  it('keeps the active project first when creation times tie', () => {
    const roots = ['D:/alpha', 'D:/beta']
    const createdAt = {
      [workspaceRootIdentityKey('D:/alpha')]: 1000,
      [workspaceRootIdentityKey('D:/beta')]: 1000
    }
    expect(groupPaths(roots, createdAt, 'D:/beta')).toEqual(['D:/beta', 'D:/alpha'])
  })

  it('falls back to legacy active-first ordering without creation times', () => {
    const roots = ['D:/alpha', 'D:/beta']
    expect(groupPaths(roots, undefined, 'D:/beta')).toEqual(['D:/beta', 'D:/alpha'])
  })

  it('keeps order stable when filesystem times advance after first-seen is recorded', () => {
    const storage = createMemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const roots = ['D:/kun', 'D:/skill']
    const keys = roots.map((root) => workspaceRootIdentityKey(root))
    const firstTimes = firstSeenTimesFor(keys, {
      [workspaceRootIdentityKey('D:/kun')]: 1000,
      [workspaceRootIdentityKey('D:/skill')]: 2000
    })
    expect(groupPaths(roots, firstTimes)).toEqual(['D:/skill', 'D:/kun'])
    const secondTimes = firstSeenTimesFor(keys, {
      [workspaceRootIdentityKey('D:/kun')]: 999999,
      [workspaceRootIdentityKey('D:/skill')]: 2000
    })
    expect(groupPaths(roots, secondTimes)).toEqual(['D:/skill', 'D:/kun'])
  })
})

describe('sidebarWorkspaceCreationTimesKey', () => {
  it('dedupes by identity key and sorts for a stable effect dependency', () => {
    const key = sidebarWorkspaceCreationTimesKey(['D:/b', 'D:/a/', 'd:/B'])
    expect(key).toBe('d:/a\nd:/b')
  })
})

describe('sidebarWorkspaceCreationTimesFromEntries', () => {
  it('keeps finite positive timestamps keyed by identity and drops the rest', () => {
    expect(sidebarWorkspaceCreationTimesFromEntries([
      { path: 'D:/ZhiHu', createdAtMs: 3000 },
      { path: 'D:/missing', createdAtMs: null },
      { path: 'D:/zero', createdAtMs: 0 }
    ])).toEqual({ [workspaceRootIdentityKey('D:/ZhiHu')]: 3000 })
  })
})
