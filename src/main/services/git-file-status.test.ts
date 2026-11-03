import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getGitFileStatus, gitStatusCodeFromPorcelain, parseGitStatusPorcelainZ } from './git-file-status'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe('git file status', () => {
  it('maps porcelain codes', () => {
    expect(gitStatusCodeFromPorcelain(' M')).toBe('modified')
    expect(gitStatusCodeFromPorcelain('A ')).toBe('added')
    expect(gitStatusCodeFromPorcelain(' D')).toBe('deleted')
    expect(gitStatusCodeFromPorcelain('R ')).toBe('renamed')
    expect(gitStatusCodeFromPorcelain('??')).toBe('untracked')
    expect(gitStatusCodeFromPorcelain('!!')).toBe('ignored')
    expect(gitStatusCodeFromPorcelain('UU')).toBe('conflicted')
  })

  it('parses NUL-separated output, skipping rename sources', () => {
    const stdout = [' M src/a.ts', 'R  src/b.ts', 'src/old-b.ts', '?? notes/', '!! node_modules/', 'D  gone.ts', ''].join('\0')
    expect(parseGitStatusPorcelainZ(stdout)).toEqual([
      { path: 'src/a.ts', status: 'modified', directory: false },
      { path: 'src/b.ts', status: 'renamed', directory: false },
      { path: 'notes', status: 'untracked', directory: true },
      { path: 'node_modules', status: 'ignored', directory: true },
      { path: 'gone.ts', status: 'deleted', directory: false }
    ])
  })

  it.skipIf(!gitAvailable())('reads a real repository relative to a sub-folder workspace', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'kun-git-status-'))
    temporaryDirectories.push(repo)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
    git('init', '-q')
    git('config', 'user.email', 'kun@example.com')
    git('config', 'user.name', 'Kun')
    await mkdir(join(repo, 'app', 'src'), { recursive: true })
    await writeFile(join(repo, '.gitignore'), 'dist/\n')
    await writeFile(join(repo, 'app', 'src', 'main.ts'), 'one\n')
    await writeFile(join(repo, 'outside.txt'), 'x\n')
    git('add', '.')
    git('commit', '-q', '-m', 'init')
    await writeFile(join(repo, 'app', 'src', 'main.ts'), 'two\n')
    await writeFile(join(repo, 'app', 'new.md'), 'new\n')
    await mkdir(join(repo, 'app', 'dist'))
    await writeFile(join(repo, 'app', 'dist', 'bundle.js'), '//\n')
    await writeFile(join(repo, 'outside.txt'), 'changed\n')

    const workspace = join(repo, 'app')
    const result = await getGitFileStatus(workspace)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byPath = Object.fromEntries(result.entries.map((entry) => [entry.path, entry.status]))
    expect(byPath[join(workspace, 'src', 'main.ts')]).toBe('modified')
    expect(byPath[join(workspace, 'new.md')]).toBe('untracked')
    expect(byPath[join(workspace, 'dist')]).toBe('ignored')
    expect(Object.keys(byPath).some((path) => path.endsWith('outside.txt'))).toBe(false)
  })
})
