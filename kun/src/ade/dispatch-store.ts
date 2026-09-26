import {
  DispatchFileSchema,
  type DispatchRecord,
  type DispatchState
} from '../contracts/ade.js'
import { adeDispatchesFile } from './ade-paths.js'
import { readAdeJson, withAdeTeamMutex, writeAdeJson } from './ade-file.js'

/** 09 §3.2 — terminal states have no outgoing transitions. */
export const ALLOWED_DISPATCH_TRANSITIONS: Record<DispatchState, readonly DispatchState[]> = {
  pending: ['delivering', 'cancelled', 'failed'],
  delivering: ['accepted', 'uncertain', 'failed'],
  uncertain: ['accepted', 'delivering', 'failed'],
  accepted: ['completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
}

export class DispatchTransitionError extends Error {
  constructor(
    readonly from: DispatchState,
    readonly to: DispatchState
  ) {
    super(`invalid dispatch transition ${from} -> ${to}`)
    this.name = 'DispatchTransitionError'
  }
}

export class FileDispatchStore {
  constructor(
    private readonly dataDir: string,
    private readonly nowIso: () => string = () => new Date().toISOString()
  ) {}

  async create(record: DispatchRecord): Promise<DispatchRecord> {
    const teamId = record.teamId
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      if (file.dispatches.some((entry) => entry.dispatchId === record.dispatchId)) {
        return file.dispatches.find((entry) => entry.dispatchId === record.dispatchId)!
      }
      file.dispatches.push(record)
      await this.writeFile(teamId, file.dispatches)
      return record
    })
  }

  async get(teamId: string, dispatchId: string): Promise<DispatchRecord | null> {
    const file = await this.readFile(teamId)
    return file.dispatches.find((entry) => entry.dispatchId === dispatchId) ?? null
  }

  /** The dispatch id doubles as the worker turn's clientRequestId (09 §5). */
  async findByClientRequestId(teamId: string, clientRequestId: string): Promise<DispatchRecord | null> {
    const file = await this.readFile(teamId)
    return file.dispatches.find((entry) => entry.dispatchId === clientRequestId) ?? null
  }

  async listByWorker(teamId: string, workerId: string): Promise<DispatchRecord[]> {
    const file = await this.readFile(teamId)
    return file.dispatches
      .filter((entry) => entry.workerId === workerId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async listByState(teamId: string, states: readonly DispatchState[]): Promise<DispatchRecord[]> {
    const wanted = new Set(states)
    const file = await this.readFile(teamId)
    return file.dispatches
      .filter((entry) => wanted.has(entry.state))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async list(teamId: string): Promise<DispatchRecord[]> {
    const file = await this.readFile(teamId)
    return [...file.dispatches].sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  /**
   * Apply a patch under the team mutex. A `state` change is validated against
   * the transition table; invalid transitions throw DispatchTransitionError.
   */
  async update(
    teamId: string,
    dispatchId: string,
    patch: Partial<Omit<DispatchRecord, 'dispatchId' | 'teamId' | 'createdAt'>>
  ): Promise<DispatchRecord | null> {
    return withAdeTeamMutex(teamId, async () => {
      const file = await this.readFile(teamId)
      const index = file.dispatches.findIndex((entry) => entry.dispatchId === dispatchId)
      if (index < 0) return null
      const current = file.dispatches[index]
      if (patch.state !== undefined && patch.state !== current.state) {
        if (!ALLOWED_DISPATCH_TRANSITIONS[current.state].includes(patch.state)) {
          throw new DispatchTransitionError(current.state, patch.state)
        }
      }
      const next: DispatchRecord = { ...current, ...patch, updatedAt: this.nowIso() }
      file.dispatches[index] = next
      await this.writeFile(teamId, file.dispatches)
      return next
    })
  }

  private async readFile(teamId: string): Promise<{ dispatches: DispatchRecord[] }> {
    const file = await readAdeJson(
      adeDispatchesFile(this.dataDir, teamId),
      DispatchFileSchema,
      () => ({ version: 1 as const, dispatches: [] as DispatchRecord[] })
    )
    return { dispatches: [...file.dispatches] }
  }

  private async writeFile(teamId: string, dispatches: DispatchRecord[]): Promise<void> {
    await writeAdeJson(adeDispatchesFile(this.dataDir, teamId), { version: 1, dispatches })
  }
}
