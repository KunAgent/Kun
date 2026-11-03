import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sweepPlanWorktrees } from './plan-worktree-sweeper'

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })

describe('sweepPlanWorktrees', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function setup(): { repo: string; root: string } {
    const base = mkdtempSync(join(tmpdir(), 'kun-sweep-'))
    dirs.push(base)
    const repo = join(base, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 't')
    writeFileSync(join(repo, 'a.txt'), '1')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'init')
    return { repo, root: join(base, 'plan-prompt') }
  }

  function addWorktree(repo: string, root: string, name: string, commit: boolean): string {
    mkdirSync(join(root, name), { recursive: true })
    const wt = join(root, name, 'repo')
    git(repo, 'worktree', 'add', '-b', `kun/${name}`, wt, 'main')
    if (commit) {
      writeFileSync(join(wt, 'b.txt'), '2')
      git(wt, 'add', '.')
      git(wt, 'commit', '-m', 'work')
    }
    return wt
  }

  const later = (): number => Date.now() + 2 * 60 * 60 * 1000

  it('removes a clean worktree whose commits are merged and deletes its branch', async () => {
    const { repo, root } = setup()
    const wt = addWorktree(repo, root, 'merged', true)
    git(repo, 'merge', '--ff-only', 'kun/merged')
    const result = await sweepPlanWorktrees({ root, now: later() })
    expect(result.removed).toEqual([wt])
    expect(existsSync(join(root, 'merged'))).toBe(false)
    expect(git(repo, 'branch', '--list', 'kun/merged').trim()).toBe('')
  })

  it('keeps unmerged, dirty, and recently active worktrees', async () => {
    const { repo, root } = setup()
    const unmerged = addWorktree(repo, root, 'unmerged', true)
    const dirty = addWorktree(repo, root, 'dirty', false)
    writeFileSync(join(dirty, 'a.txt'), 'changed')
    const fresh = addWorktree(repo, root, 'fresh', false)
    const idle = await sweepPlanWorktrees({ root, now: later() })
    expect(idle.removed).toEqual([join(root, 'fresh', 'repo')])
    expect(existsSync(unmerged) && existsSync(dirty)).toBe(true)
    const recent = await sweepPlanWorktrees({ root, now: Date.now() })
    expect(recent.removed).toEqual([])
    expect(fresh).toContain('fresh')
  })
})
