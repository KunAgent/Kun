import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

/** Temporary repositories for the commit-flow tests, isolated from the developer's own git config. */

export function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Keeps a global `commit.gpgsign` or hook path on the test machine from reaching these repositories. */
export function isolateGitConfig(): void {
  process.env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  process.env.GIT_CONFIG_NOSYSTEM = '1'
}

export type TestRepository = {
  root: string
  git: (...args: string[]) => string
  write: (path: string, content: string) => Promise<void>
}

const created: string[] = []

export async function cleanupTestRepositories(): Promise<void> {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })))
}

export async function tempDirectory(prefix: string): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)))
  created.push(path)
  return path
}

export function repositoryAt(root: string): TestRepository {
  return {
    root,
    git: (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    write: async (path, content) => {
      await mkdir(dirname(join(root, path)), { recursive: true })
      await writeFile(join(root, path), content)
    }
  }
}

export async function createTestRepository(options: { commit?: boolean } = {}): Promise<TestRepository> {
  const repo = repositoryAt(await tempDirectory('kun-git-commit-'))
  repo.git('init', '-q', '-b', 'main')
  repo.git('config', 'user.email', 'kun@example.com')
  repo.git('config', 'user.name', 'Kun')
  if (options.commit !== false) {
    await repo.write('README.md', 'one\ntwo\n')
    await repo.write('src/app.ts', 'export const a = 1\n')
    repo.git('add', '.')
    repo.git('commit', '-q', '-m', 'init')
  }
  return repo
}

/** A bare remote named `origin` for push tests. */
export async function addBareRemote(repo: TestRepository, name = 'origin'): Promise<string> {
  const remote = await tempDirectory('kun-git-remote-')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  repo.git('remote', 'add', name, remote)
  return remote
}
