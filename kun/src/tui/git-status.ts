import { execFile } from 'node:child_process'

export type GitChange = { path: string; added: number; deleted: number; binary: boolean }
export type GitSnapshot = { branch?: string; changes: GitChange[] }

const GIT_TIMEOUT_MS = 2_000
export const GIT_REFRESH_MS = 5_000

/** Parse `git diff --numstat` output; binary files report `-` counts. */
export function parseNumstat(text: string): GitChange[] {
  const changes: GitChange[] = []
  for (const line of text.split('\n')) {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/u.exec(line.trimEnd())
    if (!match) continue
    const binary = match[1] === '-' || match[2] === '-'
    changes.push({
      path: match[3]!,
      added: binary ? 0 : Number(match[1]),
      deleted: binary ? 0 : Number(match[2]),
      binary
    })
  }
  return changes
}

/** `git rev-parse --abbrev-ref HEAD`; a detached HEAD has no branch to show. */
export function parseBranch(text: string): string | undefined {
  const branch = text.trim()
  return branch && branch !== 'HEAD' ? branch : undefined
}

type RunGit = (args: string[], cwd: string) => Promise<string>

const runGit: RunGit = (args, cwd) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true }, (error, stdout) => {
    if (error) reject(error)
    else resolve(stdout)
  })
})

/** Branch and uncommitted changes against HEAD, or undefined outside a repository. */
export async function readGitSnapshot(cwd: string, run: RunGit = runGit): Promise<GitSnapshot | undefined> {
  try {
    const [branch, numstat] = await Promise.all([
      run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
      run(['diff', '--numstat', 'HEAD'], cwd).catch(() => '')
    ])
    const parsed = parseBranch(branch)
    return { ...(parsed ? { branch: parsed } : {}), changes: parseNumstat(numstat) }
  } catch {
    return undefined
  }
}

/** Polls the workspace while the TUI runs; reports only real changes. */
export class GitStatusWatcher {
  private timer?: ReturnType<typeof setInterval>
  private workspace?: string
  private last = ''
  private pending = false

  constructor(
    private readonly onChange: (snapshot: GitSnapshot | undefined) => void,
    private readonly read: (cwd: string) => Promise<GitSnapshot | undefined> = (cwd) => readGitSnapshot(cwd)
  ) {}

  watch(workspace: string): void {
    if (this.workspace === workspace && this.timer) return
    this.workspace = workspace
    this.last = ''
    if (!this.timer) {
      this.timer = setInterval(() => { void this.refresh() }, GIT_REFRESH_MS)
      this.timer.unref?.()
    }
    void this.refresh()
  }

  async refresh(): Promise<void> {
    const workspace = this.workspace
    if (!workspace || this.pending) return
    this.pending = true
    try {
      const snapshot = await this.read(workspace)
      if (workspace !== this.workspace) return
      const key = JSON.stringify(snapshot ?? null)
      if (key === this.last) return
      this.last = key
      this.onChange(snapshot)
    } finally {
      this.pending = false
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
}
