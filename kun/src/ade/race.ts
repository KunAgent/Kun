import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  RaceFileSchema,
  RaceRecommendInputSchema,
  RaceStartInputSchema,
  type RaceContender,
  type RaceRecord,
  type WorkerNotice
} from '../contracts/ade.js'
import { adeRacesFile, adeTeamsDir } from './ade-paths.js'
import { readAdeJson, withAdeTeamMutex, writeAdeJson } from './ade-file.js'
import type { FileDispatchStore } from './dispatch-store.js'
import type { FileTeamStore } from './team-store.js'
import type { WorkerNoticeSink } from './worker-notice-store.js'
import type { UsageService } from '../services/usage-service-core.js'
import type {
  ManagerRuntime,
  ManagerToolContext,
  WorkerCreateResult
} from './manager-runtime.js'
import type { ToolHostContext } from '../ports/tool-host.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import { resolveStartFrom } from '../workspace-tasks/start-from-resolver.js'
import { reportLanguage, type ReportLanguage } from './user-report.js'

const DEFAULT_RACE_TIMEOUT_MS = 60 * 60_000
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

/** `races.json` inside the team directory (10 §6.2). */
export class FileRaceStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async create(record: RaceRecord): Promise<RaceRecord> {
    return withAdeTeamMutex(record.teamId, async () => {
      const file = await this.readFile(record.teamId)
      const existing = file.races.find((entry) => entry.raceId === record.raceId)
      if (existing) return existing
      file.races.push(record)
      await this.writeFile(record.teamId, file.races)
      return record
    })
  }

  async get(teamId: string, raceId: string): Promise<RaceRecord | null> {
    return (await this.readFile(teamId)).races.find((entry) => entry.raceId === raceId) ?? null
  }

  async list(teamId: string): Promise<RaceRecord[]> {
    return (await this.readFile(teamId)).races
  }

  /** Routes carry only the raceId — scan team directories to resolve it. */
  async findRace(raceId: string): Promise<RaceRecord | null> {
    let dirs: string[] = []
    try {
      dirs = await readdir(adeTeamsDir(this.dataDir))
    } catch {
      return null
    }
    for (const dir of dirs) {
      const file = await this.readFilePath(join(adeTeamsDir(this.dataDir), dir, 'races.json'))
      const found = file.races.find((entry) => entry.raceId === raceId)
      if (found) return found
    }
    return null
  }

  async update(
    teamId: string,
    raceId: string,
    patch: Partial<RaceRecord>
  ): Promise<RaceRecord | null> {
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      const index = file.races.findIndex((entry) => entry.raceId === raceId)
      if (index < 0) return null
      const updated = { ...file.races[index], ...patch, updatedAt: this.nowIso() }
      file.races[index] = updated
      await this.writeFile(teamId, file.races)
      return updated
    })
  }

  private async readFile(teamId: string) {
    return this.readFilePath(adeRacesFile(this.dataDir, teamId))
  }

  private readFilePath(path: string) {
    return readAdeJson(path, RaceFileSchema, () => ({
      version: 1 as const,
      races: [] as RaceRecord[]
    }))
  }

  private writeFile(teamId: string, races: RaceRecord[]): Promise<void> {
    return writeAdeJson(adeRacesFile(this.dataDir, teamId), { version: 1, races })
  }
}

/** Everything race lifecycle + comparison need beyond the manager itself. */
export type RaceServiceDeps = {
  races: FileRaceStore
  dispatches: Pick<FileDispatchStore, 'get' | 'list'>
  notices: WorkerNoticeSink
  /** Worker → taskWorkspaceId resolution for compare/discard. */
  teams: Pick<FileTeamStore, 'get'>
  taskWorkspaces?: Pick<TaskWorkspaceService, 'discard'>
  usage?: Pick<UsageService, 'forThread'>
  language?: () => string | undefined
  nowIso: () => string
  nowMs?: () => number
  /** Race deadline (10 §6: default 60 minutes). */
  timeoutMs?: () => number
}

export type RaceStartResult = {
  ok: boolean
  raceId?: string
  contenders: Array<RaceContender & { ok: boolean }>
  refusal?: 'start_from_unresolved' | 'no_contenders'
  userReport: string
}

/**
 * `worker_race` (10 §6): resolve the start point once, then fork an
 * ephemeral worker per contender so all worktrees share the baseline sha.
 */
export async function startRace(
  manager: ManagerRuntime,
  deps: RaceServiceDeps & { ids: { next(prefix: string): string } },
  ctx: ManagerToolContext,
  rawInput: unknown,
  toolContext: ToolHostContext
): Promise<RaceStartResult> {
  const language = reportLanguage(deps.language?.())
  const input = RaceStartInputSchema.parse(rawInput)
  let startSha: string
  try {
    const resolved = await resolveStartFrom(
      { root: ctx.workspace },
      input.startFrom ?? { kind: 'default-branch' },
      { signal: ctx.signal }
    )
    startSha = resolved.sha
  } catch (error) {
    return {
      ok: false,
      refusal: 'start_from_unresolved',
      contenders: [],
      userReport: raceReport(language, 'fail', errorMessage(error))
    }
  }
  const raceId = deps.ids.next('race')
  const nowMs = deps.nowMs ?? Date.now
  const timeoutMs = Math.min(
    (input.timeoutMinutes ?? 60) * 60_000,
    DEFAULT_RACE_TIMEOUT_MS * 8
  )
  const deadlineAt = new Date(nowMs() + timeoutMs).toISOString()
  const contenders: Array<RaceContender & { ok: boolean }> = []
  for (const contender of input.contenders) {
    const label = raceContenderLabel(input.label, contender.harnessId, contender.model)
    const created = await manager
      .createWorker(ctx, {
        label,
        task: input.task,
        agent: {
          harnessId: contender.harnessId,
          ...(contender.model ? { model: contender.model } : {})
        },
        workspace: {
          isolation: 'worktree',
          startFrom: { kind: 'commit', sha: startSha }
        },
        lifecycle: 'ephemeral'
      }, { ...toolContext, activeToolCallId: undefined })
      .catch((error: unknown): WorkerCreateResult => ({
        ok: false,
        userReport: errorMessage(error)
      }))
    contenders.push({
      ok: created.ok === true && Boolean(created.dispatchId),
      harnessId: contender.harnessId,
      ...(contender.model ? { model: contender.model } : {}),
      label,
      ...(created.dispatchId ? { dispatchId: created.dispatchId } : {}),
      ...(created.workerId ? { workerId: created.workerId } : {}),
      ...(created.ok ? {} : { createError: created.userReport })
    })
  }
  const live = contenders.filter((entry) => entry.ok)
  const record = await deps.races.create({
    raceId,
    teamId: ctx.threadId,
    label: input.label,
    task: input.task,
    startSha,
    contenders: contenders.map(({ ok: _ok, ...rest }) => rest),
    state: live.length === 0 ? 'ready' : 'running',
    deadlineAt,
    createdAt: deps.nowIso(),
    updatedAt: deps.nowIso()
  })
  if (record.state === 'running') {
    scheduleRaceDeadline(deps, ctx.threadId, deadlineAt)
  }
  const anyCreated = live.length > 0
  return {
    ok: anyCreated,
    raceId,
    contenders,
    ...(!anyCreated ? { refusal: 'no_contenders' as const } : {}),
    userReport: raceReport(
      language,
      anyCreated ? 'ok' : 'fail',
      `${live.length}/${contenders.length} contender(s) dispatched from ${startSha.slice(0, 12)}`
    )
  }
}

/**
 * running → ready once every live contender's dispatch is terminal or the
 * deadline passed (10 §6.3). Called on worker-turn terminal, on the
 * deadline timer, and lazily from the read route after restarts.
 */
export async function reconcileRaces(
  deps: RaceServiceDeps,
  teamId: string
): Promise<void> {
  const nowMs = deps.nowMs ?? Date.now
  for (const race of await deps.races.list(teamId)) {
    if (race.state !== 'running') continue
    const live = race.contenders.filter(
      (entry) => entry.dispatchId && !entry.createError
    )
    const allTerminal = await Promise.all(
      live.map(async (entry) =>
        TERMINAL.has(
          (await deps.dispatches.get(teamId, entry.dispatchId!))?.state ?? ''
        )
      )
    ).then((flags) => flags.every(Boolean))
    const expired = Date.parse(race.deadlineAt) <= nowMs()
    if (!allTerminal && !expired) continue
    const updated = await deps.races.update(teamId, race.raceId, {
      state: 'ready',
      notifiedAt: deps.nowIso()
    })
    if (!updated) continue
    await deps.notices.enqueue(raceNotice(race, deps)).catch((error) => {
      console.warn(`[kun] ade race notice enqueue failed for ${race.raceId}:`, error)
    })
  }
}

/** User-only winner selection (10 §6.4); the manager can never call this. */
export async function decideRace(
  deps: RaceServiceDeps,
  raceId: string,
  winnerDispatchId: string
): Promise<{ ok: boolean; refusal?: string; race?: RaceRecord }> {
  const found = await deps.races.findRace(raceId)
  if (!found) return { ok: false, refusal: 'race_not_found' }
  await reconcileRaces(deps, found.teamId)
  const race = (await deps.races.get(found.teamId, raceId)) ?? found
  if (race.state !== 'ready') return { ok: false, refusal: 'race_not_ready' }
  if (!race.contenders.some((entry) => entry.dispatchId === winnerDispatchId)) {
    return { ok: false, refusal: 'winner_not_contender' }
  }
  const updated = await deps.races.update(race.teamId, raceId, {
    state: 'decided',
    winnerDispatchId
  })
  return { ok: true, race: updated ?? undefined }
}

/**
 * Discard every non-winner task workspace after decide (10 §6.5, 07 §8.3);
 * each contender's discard runs under the record's task-workspace rules.
 */
export async function discardRaceOthers(
  deps: RaceServiceDeps,
  raceId: string,
  confirm: boolean
): Promise<{
  ok: boolean
  refusal?: string
  discarded: Array<{ dispatchId?: string; workspaceId?: string; ok: boolean }>
}> {
  const race = await deps.races.findRace(raceId)
  if (!race) return { ok: false, refusal: 'race_not_found', discarded: [] }
  if (race.state !== 'decided' || !race.winnerDispatchId) {
    return { ok: false, refusal: 'race_not_decided', discarded: [] }
  }
  if (!confirm) return { ok: false, refusal: 'confirm_required', discarded: [] }
  if (!deps.taskWorkspaces) {
    return { ok: false, refusal: 'task_workspaces_unavailable', discarded: [] }
  }
  const team = await deps.teams.get(race.teamId).catch(() => null)
  const discarded: Array<{ dispatchId?: string; workspaceId?: string; ok: boolean }> = []
  for (const contender of race.contenders) {
    if (contender.dispatchId === race.winnerDispatchId || !contender.workerId) continue
    const workspaceId = team?.workers.find(
      (entry) => entry.workerId === contender.workerId
    )?.taskWorkspaceId
    if (!workspaceId) {
      discarded.push({ dispatchId: contender.dispatchId, ok: false })
      continue
    }
    const result = await deps.taskWorkspaces
      .discard(workspaceId, true)
      .then(() => true)
      .catch(() => false)
    discarded.push({ dispatchId: contender.dispatchId, workspaceId, ok: result })
  }
  return { ok: true, discarded }
}

/** `race_recommend` (10 §6.4): the only manager write on a race — notes. */
export async function recommendRace(
  deps: RaceServiceDeps,
  ctx: ManagerToolContext,
  rawInput: unknown
): Promise<{ ok: boolean; refusal?: string; userReport: string }> {
  const language = reportLanguage(deps.language?.())
  const parsed = RaceRecommendInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return { ok: false, refusal: 'invalid_input', userReport: raceReport(language, 'fail', 'invalid race_recommend input') }
  }
  const race = await deps.races.get(ctx.threadId, parsed.data.raceId)
  if (!race) {
    return { ok: false, refusal: 'race_not_found', userReport: raceReport(language, 'fail', 'unknown race') }
  }
  const updated = await deps.races.update(ctx.threadId, race.raceId, {
    notes: parsed.data.notes
  })
  return {
    ok: Boolean(updated),
    userReport: raceReport(language, updated ? 'ok' : 'fail', race.label)
  }
}

function scheduleRaceDeadline(
  deps: RaceServiceDeps,
  teamId: string,
  deadlineAt: string
): void {
  const nowMs = deps.nowMs ?? Date.now
  const delay = Math.max(0, Date.parse(deadlineAt) - nowMs())
  const timer = setTimeout(() => {
    void reconcileRaces(deps, teamId).catch((error) => {
      console.warn(`[kun] ade race reconcile failed for ${teamId}:`, error)
    })
  }, Math.min(delay, 2_147_483_647))
  timer.unref?.()
}

function raceNotice(race: RaceRecord, deps: RaceServiceDeps): WorkerNotice {
  const lines = race.contenders.map((entry) =>
    `${entry.harnessId}${entry.model ? ` ${entry.model}` : ''}: ${
      entry.createError ? `create failed — ${entry.createError}` : 'finished'
    }`
  )
  return {
    noticeId: `ntc_race_${race.raceId}`,
    teamId: race.teamId,
    workerId: race.contenders.find((entry) => entry.workerId)?.workerId ?? race.raceId,
    kind: 'race_ready',
    dispatchId: race.contenders[0]?.dispatchId,
    title: race.label,
    detail: lines.join('\n').slice(0, 4_000),
    attempts: 0,
    createdAt: deps.nowIso()
  }
}

function raceContenderLabel(label: string, harnessId: string, model?: string): string {
  const suffix = ` · ${harnessId}${model ? ` ${model}` : ''}`
  const full = `${label}${suffix}`
  return full.length <= 64 ? full : `${label.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`.slice(0, 64)
}

function raceReport(language: ReportLanguage, tone: 'ok' | 'fail', detail: string): string {
  return language === 'zh'
    ? tone === 'ok' ? `赛马已安排：${detail}` : `赛马未开始：${detail}`
    : tone === 'ok' ? `Race dispatched: ${detail}` : `Race not started: ${detail}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
