import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const ROOM_REVISION_HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/

/** No shell, inherited Git redirection, repository hooks, or external diff programs. */
export async function runRoomGit(cwd: string, args: string[]): Promise<string> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG(?:_.*)?|CEILING_DIRECTORIES)$/.test(key)) {
      delete env[key]
    }
  }
  const result = await exec('git', ['--no-optional-locks', '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgSign=false', ...args], {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 32 * 1024 * 1024,
    env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  })
  return result.stdout
}

export async function roomGit(cwd: string, args: string[]): Promise<string> {
  return (await runRoomGit(cwd, args)).replace(/\r?\n$/, '')
}

export async function assertRoomAncestor(cwd: string, ancestor: string, head: string): Promise<void> {
  if (!ROOM_REVISION_HASH.test(ancestor) || !ROOM_REVISION_HASH.test(head)) throw new Error('invalid revision')
  try { await roomGit(cwd, ['merge-base', '--is-ancestor', ancestor, head]) } catch {
    throw new Error('delivery history is not a fast-forward descendant; preserve worktree for recovery')
  }
}
