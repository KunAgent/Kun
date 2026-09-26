import { rm } from 'node:fs/promises'
import {
  TeamFileSchema,
  TeamLimitsSchema,
  type TeamLimits,
  type TeamRecord,
  type WorkerRecord
} from '../contracts/ade.js'
import { adeTeamDir, adeTeamFile } from './ade-paths.js'
import { readAdeJson, withAdeTeamMutex, writeAdeJson } from './ade-file.js'

/**
 * Per-manager team record store. One `team.json` per manager thread under
 * `dataDir/ade/teams/<managerThreadId>/`; `teamId` is the manager thread id.
 */
export class FileTeamStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async ensure(managerThreadId: string, limits?: Partial<TeamLimits>): Promise<TeamRecord> {
    return withAdeTeamMutex(managerThreadId, async () => {
      const existing = await this.readFile(managerThreadId)
      if (existing) return existing
      const now = this.nowIso()
      const team: TeamRecord = {
        version: 1,
        teamId: managerThreadId,
        managerThreadId,
        status: 'active',
        limits: TeamLimitsSchema.parse(limits ?? {}),
        workers: [],
        createdAt: now,
        updatedAt: now
      }
      await this.writeFile(managerThreadId, team)
      return team
    })
  }

  async get(teamId: string): Promise<TeamRecord | null> {
    return this.readFile(teamId)
  }

  async byManager(managerThreadId: string): Promise<TeamRecord | null> {
    return this.readFile(managerThreadId)
  }

  async worker(teamId: string, workerId: string): Promise<WorkerRecord | null> {
    const team = await this.readFile(teamId)
    return team?.workers.find((entry) => entry.workerId === workerId) ?? null
  }

  async upsertWorker(teamId: string, worker: WorkerRecord): Promise<WorkerRecord> {
    return withAdeTeamMutex(teamId, async () => {
      const team = await this.readFile(teamId)
      if (!team) throw new Error(`ade team ${teamId} does not exist`)
      const index = team.workers.findIndex((entry) => entry.workerId === worker.workerId)
      const workers = [...team.workers]
      if (index >= 0) workers[index] = worker
      else workers.push(worker)
      const next: TeamRecord = { ...team, workers, updatedAt: this.nowIso() }
      await this.writeFile(teamId, next)
      return worker
    })
  }

  async updateWorker(
    teamId: string,
    workerId: string,
    patch: Partial<Pick<WorkerRecord, 'control' | 'state' | 'releasedAt' | 'taskWorkspaceId' | 'role' | 'label'>>
  ): Promise<WorkerRecord | null> {
    return withAdeTeamMutex(teamId, async () => {
      const team = await this.readFile(teamId)
      if (!team) return null
      const index = team.workers.findIndex((entry) => entry.workerId === workerId)
      if (index < 0) return null
      const updated: WorkerRecord = { ...team.workers[index], ...patch }
      const workers = [...team.workers]
      workers[index] = updated
      await this.writeFile(teamId, { ...team, workers, updatedAt: this.nowIso() })
      return updated
    })
  }

  async endTeam(teamId: string): Promise<void> {
    await withAdeTeamMutex(teamId, async () => {
      const team = await this.readFile(teamId)
      if (!team || team.status === 'ended') return
      await this.writeFile(teamId, { ...team, status: 'ended', updatedAt: this.nowIso() })
    })
  }

  /** Delete-cascade entry: remove the whole team directory for a manager thread. */
  async removeTeam(managerThreadId: string): Promise<void> {
    await rm(adeTeamDir(this.dataDir, managerThreadId), { recursive: true, force: true })
  }

  private async readFile(managerThreadId: string): Promise<TeamRecord | null> {
    const file = await readAdeJson(adeTeamFile(this.dataDir, managerThreadId), TeamFileSchema, () => null)
    return file?.team ?? null
  }

  private async writeFile(managerThreadId: string, team: TeamRecord): Promise<void> {
    await writeAdeJson(adeTeamFile(this.dataDir, managerThreadId), { version: 1, team })
  }
}
