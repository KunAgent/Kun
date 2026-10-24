import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import type { GitFailureReason } from '../../shared/git-commit'

export type GitCommandResult = { stdout: string; stderr: string; code: number }

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message)
    this.name = 'GitCommandError'
  }

  /** What git printed, for the copyable error text. */
  get output(): string {
    return [this.stderr.trim(), this.stdout.trim()].filter(Boolean).join('\n')
  }
}

/**
 * Runs git without a shell. Exit codes in `okCodes` resolve (diff --no-index
 * and config lookups use 1 for "different" / "missing"); anything else rejects
 * with git's own output attached. Diagnostics stay in English (`LC_ALL=C`) so
 * failures can be classified, and credential prompts fail fast instead of
 * waiting on a terminal nobody can see.
 */
export function execGit(
  cwd: string,
  args: string[],
  options: { timeout?: number; maxBuffer?: number; okCodes?: number[] } = {}
): Promise<GitCommandResult> {
  const okCodes = options.okCodes ?? [0]
  return new Promise((resolve, reject) => {
    execFile('git', args, {
      cwd,
      timeout: options.timeout ?? 15_000,
      maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
    }, (error, stdout, stderr) => {
      const out = String(stdout ?? '')
      const err = String(stderr ?? '')
      if (!error) {
        resolve({ stdout: out, stderr: err, code: 0 })
        return
      }
      const code = (error as NodeJS.ErrnoException & { code?: number | string }).code ?? null
      if (typeof code === 'number' && okCodes.includes(code)) {
        resolve({ stdout: out, stderr: err, code })
        return
      }
      const killed = (error as { killed?: boolean }).killed === true
      const detail = killed ? `git ${args[0] ?? ''} timed out.` : (err.trim() || error.message)
      reject(new GitCommandError(detail, code, out, err))
    })
  })
}

export function gitFailure(error: unknown): { reason: GitFailureReason; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof GitCommandError ? error.code : (error as { code?: unknown })?.code
  if (/not a git repository/i.test(message)) {
    return { reason: 'not_git_repo', message: 'The working directory is not a Git repository.' }
  }
  if (code === 'ENOENT' || /spawn git ENOENT/i.test(message)) {
    return { reason: 'git_unavailable', message: 'Git executable was not found.' }
  }
  return { reason: 'error', message }
}

/**
 * A path the renderer may hand back for an operation: repository-relative,
 * forward slashes, no parent segments. Anything else is refused before git or
 * the file system sees it.
 */
export function isSafeRepositoryPath(path: string): boolean {
  if (!path || path.length > 4_096 || path.includes('\0')) return false
  if (isAbsolute(path) || /^[a-zA-Z]:/.test(path) || path.startsWith('/') || path.startsWith('\\')) return false
  return path.split(/[\\/]/).every((segment) => segment !== '..' && segment !== '.' && segment !== '')
}

export function isOutputOverflow(error: unknown): boolean {
  return error instanceof GitCommandError && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
}

export const FULL_COMMIT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/
