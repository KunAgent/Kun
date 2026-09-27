import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ChangeRequestCheck,
  ChangeRequestSnapshot,
  ChangeRequestStatus,
  CreateChangeRequestRequest,
  TaskWorkspaceRecord
} from '../contracts/task-workspace.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import type { FileTeamStore } from './team-store.js'
import type { FileDispatchStore } from './dispatch-store.js'

const execFileAsync = promisify(execFile)

type ExecResult = { stdout: string; stderr: string }
export type ChangeRequestExec = (
  bin: string,
  args: string[],
  cwd: string
) => Promise<ExecResult>

const defaultExec: ChangeRequestExec = async (bin, args, cwd) => {
  const result = await execFileAsync(bin, args, {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

/** Remote URL → forge kind; only GitHub gets create/status support in P2. */
export function detectForgeFromRemote(url: string | null): 'github' | 'gitlab' | 'other' | null {
  if (!url) return null
  const host = (() => {
    const ssh = /^git@([^:]+):/.exec(url)
    if (ssh) return ssh[1]
    try {
      return new URL(url).hostname
    } catch {
      return null
    }
  })()
  if (!host) return 'other'
  const lower = host.toLowerCase()
  if (lower === 'github.com' || lower.endsWith('.github.com')) return 'github'
  if (lower === 'gitlab.com' || lower.includes('gitlab')) return 'gitlab'
  return 'other'
}

function failName(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** `statusCheckRollup` rows arrive as CheckRun or StatusContext — normalize both. */
function normalizeChecks(raw: unknown): ChangeRequestCheck[] {
  if (!Array.isArray(raw)) return []
  const checks: ChangeRequestCheck[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const entry = row as Record<string, unknown>
    const name = typeof entry.name === 'string'
      ? entry.name
      : typeof entry.context === 'string' ? entry.context : ''
    if (!name) continue
    // CheckRun: status + conclusion; StatusContext: state only.
    const stateRaw = (typeof entry.state === 'string' ? entry.state : '').toUpperCase()
    const conclusion = typeof entry.conclusion === 'string'
      ? entry.conclusion.toLowerCase()
      : stateRaw && stateRaw !== 'PENDING' && stateRaw !== 'EXPECTED'
        ? stateRaw.toLowerCase()
        : undefined
    const started = typeof entry.startedAt === 'string' ? Date.parse(entry.startedAt) : NaN
    const completed = typeof entry.completedAt === 'string' ? Date.parse(entry.completedAt) : NaN
    const statusRaw = (typeof entry.status === 'string' ? entry.status : '').toUpperCase()
    const pending = statusRaw === 'QUEUED' || statusRaw === 'PENDING'
      || stateRaw === 'PENDING' || stateRaw === 'EXPECTED'
    checks.push({
      name,
      status: statusRaw === 'COMPLETED' || Boolean(conclusion)
        ? 'completed'
        : pending ? 'pending' : 'in_progress',
      ...(conclusion ? { conclusion } : {}),
      ...(typeof entry.detailsUrl === 'string' ? { detailsUrl: entry.detailsUrl } : {}),
      ...(typeof entry.targetUrl === 'string' ? { detailsUrl: entry.targetUrl } : {}),
      ...(Number.isFinite(started) && Number.isFinite(completed)
        ? { durationMs: Math.max(0, completed - started) }
        : {})
    })
  }
  return checks
}

/**
 * Forge change requests for task workspaces (docs/ade/11 §7.2). GitHub is
 * the only forge with create/status support in P2 — GitLab and unknown
 * remotes are detected and reported as unsupported so the UI can explain.
 * `gh` shells out inside the WORKTREE path, never the source checkout.
 */
export class ChangeRequestService {
  constructor(private readonly deps: {
    taskWorkspaces: Pick<TaskWorkspaceService, 'get' | 'setChangeRequest'>
    teams?: Pick<FileTeamStore, 'list'>
    dispatches?: Pick<FileDispatchStore, 'listByWorker'>
    exec?: ChangeRequestExec
    nowIso: () => string
  }) {}

  private get exec(): ChangeRequestExec {
    return this.deps.exec ?? defaultExec
  }

  private async remoteUrl(record: TaskWorkspaceRecord): Promise<string | null> {
    const configured = await this.exec(
      'git', ['config', '--get', 'remote.origin.url'], record.sourceRoot
    ).then((r) => r.stdout.trim()).catch(() => '')
    if (configured) return configured
    const first = await this.exec('git', ['remote'], record.sourceRoot)
      .then((r) => r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)[0])
      .catch(() => undefined)
    if (!first) return null
    return this.exec('git', ['remote', 'get-url', first], record.sourceRoot)
      .then((r) => r.stdout.trim() || null)
      .catch(() => null)
  }

  /** Why creation is unavailable; `null` when GitHub + gh are usable. */
  private async availabilityFor(
    record: TaskWorkspaceRecord
  ): Promise<Pick<ChangeRequestStatus, 'available' | 'forge' | 'reason'>> {
    const forge = detectForgeFromRemote(await this.remoteUrl(record))
    if (!forge) return { available: false, reason: 'no-remote' }
    if (forge !== 'github') return { available: false, forge, reason: 'forge-not-supported' }
    if (!record.branch) return { available: false, forge, reason: 'no-branch' }
    const auth = await this.exec('gh', ['auth', 'status'], record.path)
      .then(() => true)
      .catch((error: unknown) =>
        (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'not-installed' : false)
    if (auth === 'not-installed') {
      return { available: false, forge, reason: 'gh-not-installed' }
    }
    if (!auth) return { available: false, forge, reason: 'gh-not-authed' }
    return { available: true, forge }
  }

  private async defaultBase(record: TaskWorkspaceRecord): Promise<string | null> {
    if (record.targetBranch) return record.targetBranch
    const start = record.startFrom
    if (start.kind === 'branch') return start.name
    if (start.kind === 'remote-branch') return start.name
    const head = await this.exec(
      'git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], record.sourceRoot
    ).then((r) => r.stdout.trim()).catch(() => '')
    if (head.startsWith('origin/')) return head.slice('origin/'.length)
    return null
  }

  /** Default PR body: task, worker report, verdict, checks (11 §7.2). */
  private async buildBody(record: TaskWorkspaceRecord, title: string): Promise<string> {
    const parts = [`## Task`, '', record.label ?? title]
    const unitId = record.unitId
    if (unitId && this.deps.teams && this.deps.dispatches) {
      const team = (await this.deps.teams.list().catch(() => []))
        .find((entry) => entry.workers.some((w) => w.workerId === unitId))
      const dispatch = team
        ? (await this.deps.dispatches.listByWorker(team.teamId, unitId).catch(() => [])).at(-1)
        : undefined
      if (dispatch) {
        parts.length = 0
        parts.push('## Task', '', dispatch.task.slice(0, 4_000))
      }
      const report = dispatch?.workerReport?.summary ?? dispatch?.resultExcerpt
      if (report) parts.push('', '## Worker report', '', report)
      const verdict = dispatch?.verdict
      if (verdict) {
        parts.push('', '## Verdict', '', verdict.status)
        if (verdict.notes) parts.push('', verdict.notes)
      }
      const checks = verdict?.checks?.length
        ? verdict.checks
        : dispatch?.workerReport?.checks ?? []
      if (checks.length) {
        parts.push('', '## Checks', '')
        for (const check of checks) parts.push(`- ${check.name}: ${check.status}`)
      }
    }
    return `${parts.join('\n')}\n`
  }

  async status(workspaceId: string): Promise<ChangeRequestStatus> {
    const record = this.deps.taskWorkspaces.get(workspaceId)
    if (!record) throw new Error('task workspace not found')
    const availability = await this.availabilityFor(record)
    const persisted = record.changeRequest
    if (!persisted) return { ...availability }
    if (!availability.available) return { ...availability, request: persisted }
    const ref = String(persisted.number)
    try {
      const { stdout } = await this.exec(
        'gh',
        ['pr', 'view', ref, '--json',
          'number,state,title,url,isDraft,baseRefName,headRefName,statusCheckRollup'],
        record.path
      )
      const view = JSON.parse(stdout) as Record<string, unknown>
      const state = String(view.state ?? '').toLowerCase()
      const snapshot: ChangeRequestSnapshot = {
        provider: 'github',
        number: typeof view.number === 'number' ? view.number : persisted.number,
        url: typeof view.url === 'string' ? view.url : persisted.url,
        title: typeof view.title === 'string' ? view.title : persisted.title,
        state: state === 'merged' || state === 'closed' ? state : 'open',
        ...(view.isDraft === true ? { isDraft: true } : {}),
        ...(typeof view.baseRefName === 'string' ? { base: view.baseRefName } : {}),
        ...(typeof view.headRefName === 'string' ? { head: view.headRefName } : {}),
        checks: normalizeChecks(view.statusCheckRollup),
        checkedAt: this.deps.nowIso()
      }
      this.deps.taskWorkspaces.setChangeRequest(workspaceId, snapshot)
      return { ...availability, request: snapshot }
    } catch (error) {
      // gh can fail when the branch/PR was deleted; keep the persisted row.
      return { ...availability, request: persisted, error: failName(error).slice(0, 200) }
    }
  }

  async create(
    workspaceId: string,
    input: CreateChangeRequestRequest
  ): Promise<{ ok: true; request: ChangeRequestSnapshot } | { ok: false; reason: string; userReport: string }> {
    const record = this.deps.taskWorkspaces.get(workspaceId)
    if (!record) return { ok: false, reason: 'not-found', userReport: 'task workspace not found' }
    if (record.changeRequest) {
      return { ok: true, request: record.changeRequest }
    }
    const availability = await this.availabilityFor(record)
    if (!availability.available) {
      return {
        ok: false,
        reason: availability.reason ?? 'unavailable',
        userReport: availability.reason ?? 'change requests are unavailable'
      }
    }
    const branch = record.branch!
    const base = input.base ?? (await this.defaultBase(record))
    if (!base) {
      return { ok: false, reason: 'no-base', userReport: 'cannot determine the PR base branch' }
    }
    const title = input.title ?? record.label ?? branch
    const body = input.body ?? (await this.buildBody(record, title))
    await this.exec('git', ['push', '-u', 'origin', branch], record.path)
    const dir = await mkdtemp(join(tmpdir(), 'kun-pr-'))
    try {
      const bodyFile = join(dir, 'body.md')
      await writeFile(bodyFile, body, 'utf8')
      const { stdout } = await this.exec(
        'gh',
        ['pr', 'create', '--base', base, '--head', branch,
          '--title', title, '--body-file', bodyFile],
        record.path
      )
      const url = stdout.trim().split('\n').at(-1) ?? ''
      const number = Number(/\/pull\/(\d+)/.exec(url)?.[1])
      const snapshot: ChangeRequestSnapshot = {
        provider: 'github',
        number: Number.isFinite(number) && number > 0 ? number : 0,
        url,
        title,
        state: 'open',
        base,
        head: branch,
        checks: [],
        checkedAt: this.deps.nowIso()
      }
      if (!(snapshot.number > 0) || !snapshot.url.startsWith('http')) {
        return { ok: false, reason: 'parse-failed', userReport: 'gh pr create returned no PR url' }
      }
      this.deps.taskWorkspaces.setChangeRequest(workspaceId, snapshot)
      return { ok: true, request: snapshot }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
