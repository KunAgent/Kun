import { describe, expect, it, vi } from 'vitest'
import { GitStatusWatcher, parseBranch, parseNumstat, readGitSnapshot, type GitSnapshot } from './git-status.js'

describe('git status', () => {
  it('parses numstat rows, binary files included', () => {
    expect(parseNumstat('12\t3\tsrc/a.ts\n-\t-\tlogo.png\n\nnot a row\n0\t7\tdocs/old name.md\n')).toEqual([
      { path: 'src/a.ts', added: 12, deleted: 3, binary: false },
      { path: 'logo.png', added: 0, deleted: 0, binary: true },
      { path: 'docs/old name.md', added: 0, deleted: 7, binary: false }
    ])
  })

  it('shows no branch for a detached HEAD', () => {
    expect(parseBranch('kun/tui-redesign\n')).toBe('kun/tui-redesign')
    expect(parseBranch('HEAD\n')).toBeUndefined()
    expect(parseBranch('')).toBeUndefined()
  })

  it('reads branch and changes, and nothing outside a repository', async () => {
    const run = vi.fn(async (args: string[]) => (args[0] === 'rev-parse' ? 'develop\n' : '1\t2\ta.ts\n'))
    await expect(readGitSnapshot('/repo', run)).resolves.toEqual({
      branch: 'develop',
      changes: [{ path: 'a.ts', added: 1, deleted: 2, binary: false }]
    })
    const fail = vi.fn(async () => { throw new Error('not a git repository') })
    await expect(readGitSnapshot('/tmp', fail)).resolves.toBeUndefined()
  })

  it('reports a snapshot only when it changes', async () => {
    const seen: Array<GitSnapshot | undefined> = []
    let snapshot: GitSnapshot = { branch: 'develop', changes: [] }
    const watcher = new GitStatusWatcher((value) => seen.push(value), async () => snapshot)
    watcher.watch('/repo')
    await watcher.refresh()
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    await watcher.refresh()
    expect(seen).toHaveLength(1)
    snapshot = { branch: 'develop', changes: [{ path: 'a.ts', added: 1, deleted: 0, binary: false }] }
    await watcher.refresh()
    expect(seen).toHaveLength(2)
    watcher.stop()
  })
})
