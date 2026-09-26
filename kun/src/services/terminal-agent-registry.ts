import { join } from 'node:path'
import { z } from 'zod'
import {
  ActivityWorkspaceSchema,
  type ActivityPatch,
  type ActivityState,
  type RegisterUnit
} from '../contracts/activity.js'
import { HarnessIdSchema, type HarnessId } from '../contracts/harness.js'
import { adeRootDir } from '../ade/ade-paths.js'
import { readAdeJson, writeAdeJson } from '../ade/ade-file.js'
import { withManagerDataMutex } from '../manager/data-mutex.js'

/**
 * Tier-0 terminal agents (05 §6.1): execution units launched as PTY
 * processes by the desktop main process. They own no thread, so the
 * registry persists them under `dataDir/ade/terminal-agents.json` and
 * restores unconfirmed rows after a restart.
 */

export const TerminalAgentRecordSchema = z
  .object({
    unitId: z.string().min(1).max(128),
    harnessId: HarnessIdSchema,
    title: z.string().max(200),
    workspace: ActivityWorkspaceSchema,
    parentThreadId: z.string().min(1).max(256).optional(),
    taskWorkspaceId: z.string().min(1).max(256).optional(),
    mainState: z.enum(['initializing', 'working', 'waiting', 'done', 'failed', 'idle', 'closed']),
    /** Set by an interrupt hint; consumed by the Stop-hook mapping. */
    inferredInterrupt: z.boolean().default(false),
    exitCode: z.number().int().optional(),
    signal: z.string().max(64).optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .strict()
export type TerminalAgentRecord = z.infer<typeof TerminalAgentRecordSchema>

const TerminalAgentFileSchema = z
  .object({
    version: z.literal(1),
    units: z.array(TerminalAgentRecordSchema).max(256).default([])
  })
  .strict()

export type TerminalAgentCreateInput = {
  harnessId: HarnessId
  title: string
  workspace: z.infer<typeof ActivityWorkspaceSchema>
  parentThreadId?: string
  taskWorkspaceId?: string
}

type ActivitySink = {
  register(input: RegisterUnit): unknown
  apply(
    unitId: string,
    patch: ActivityPatch,
    provenance: 'runtime' | 'restored' | 'inferred' | 'hook'
  ): void
}

export type TerminalAgentRegistryDeps = {
  dataDir: string
  activity?: ActivitySink
  nowIso?: () => string
  idGenerator?: () => string
}

function filePath(dataDir: string): string {
  return join(adeRootDir(dataDir), 'terminal-agents.json')
}

export class TerminalAgentRegistry {
  private readonly nowIso: () => string

  constructor(private readonly deps: TerminalAgentRegistryDeps) {
    this.nowIso = deps.nowIso ?? (() => new Date().toISOString())
  }

  async register(input: TerminalAgentCreateInput): Promise<TerminalAgentRecord> {
    const unitId = this.deps.idGenerator?.() ?? `tu_${Math.random().toString(36).slice(2, 12)}`
    const now = this.nowIso()
    const record: TerminalAgentRecord = {
      unitId,
      harnessId: input.harnessId,
      title: input.title,
      workspace: input.workspace,
      ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
      ...(input.taskWorkspaceId ? { taskWorkspaceId: input.taskWorkspaceId } : {}),
      mainState: 'working',
      inferredInterrupt: false,
      createdAt: now,
      updatedAt: now
    }
    await this.mutate((file) => {
      file.units.push(record)
      return file
    })
    this.deps.activity?.register({
      unitId,
      kind: 'terminal-agent',
      threadId: unitId,
      ...(input.parentThreadId ? { parentThreadId: input.parentThreadId } : {}),
      harnessId: input.harnessId,
      title: input.title,
      workspace: input.workspace,
      mainState: 'working',
      provenance: 'runtime'
    })
    return record
  }

  async reportExit(
    unitId: string,
    exit: { exitCode: number; signal?: string }
  ): Promise<TerminalAgentRecord | null> {
    await this.mutate((file) => {
      const entry = file.units.find((unit) => unit.unitId === unitId)
      if (!entry) return file
      entry.mainState = 'closed'
      entry.exitCode = exit.exitCode
      if (exit.signal) entry.signal = exit.signal
      entry.updatedAt = this.nowIso()
      return file
    })
    const record = await this.get(unitId)
    if (!record) return null
    this.deps.activity?.apply(unitId, {
      mainState: 'closed',
      lastOutcome: exit.exitCode === 0 ? 'completed' : 'failed'
    }, 'runtime')
    return record
  }

  /**
   * The main process observed an interrupt keystroke in the unit's PTY.
   * Persisted as a fact: the next Stop hook resolves to `cancelled`
   * instead of `done` (05 §6.3; the row write carries 'inferred').
   */
  async interruptHint(unitId: string): Promise<boolean> {
    let found = false
    await this.mutate((file) => {
      const entry = file.units.find((unit) => unit.unitId === unitId)
      if (!entry || entry.mainState === 'closed') return file
      entry.inferredInterrupt = true
      entry.updatedAt = this.nowIso()
      found = true
      return file
    })
    return found
  }

  /** Read+clear the pending interrupt hint (consumed by hook mapping). */
  async consumeInterruptHint(unitId: string): Promise<boolean> {
    let had = false
    await this.mutate((file) => {
      const entry = file.units.find((unit) => unit.unitId === unitId)
      if (!entry?.inferredInterrupt) return file
      entry.inferredInterrupt = false
      entry.updatedAt = this.nowIso()
      had = true
      return file
    })
    return had
  }

  async get(unitId: string): Promise<TerminalAgentRecord | null> {
    const file = await this.read()
    return file.units.find((unit) => unit.unitId === unitId) ?? null
  }

  async list(): Promise<TerminalAgentRecord[]> {
    return (await this.read()).units
  }

  /** Hook/channel state writes also persist so a restart keeps truth. */
  async applyState(unitId: string, patch: {
    mainState?: ActivityState
    provenance: 'runtime' | 'inferred' | 'hook'
  }): Promise<void> {
    await this.mutate((file) => {
      const entry = file.units.find((unit) => unit.unitId === unitId)
      if (!entry) return file
      if (patch.mainState) entry.mainState = patch.mainState
      entry.updatedAt = this.nowIso()
      return file
    })
  }

  /**
   * After a restart, units without an exit report re-register as
   * `restoredUnconfirmed` rows — the PTY died with the old session but the
   * exit report may have been lost, so the row is not treated as live truth.
   */
  async restore(): Promise<number> {
    const file = await this.read()
    let restored = 0
    for (const unit of file.units) {
      if (unit.mainState === 'closed') continue
      this.deps.activity?.register({
        unitId: unit.unitId,
        kind: 'terminal-agent',
        threadId: unit.unitId,
        ...(unit.parentThreadId ? { parentThreadId: unit.parentThreadId } : {}),
        harnessId: unit.harnessId,
        title: unit.title,
        workspace: unit.workspace,
        mainState: unit.mainState,
        provenance: 'restored',
        restoredUnconfirmed: true
      })
      restored += 1
    }
    return restored
  }

  private async read(): Promise<{ version: 1; units: TerminalAgentRecord[] }> {
    return readAdeJson(filePath(this.deps.dataDir), TerminalAgentFileSchema, () => ({
      version: 1 as const,
      units: [] as TerminalAgentRecord[]
    }))
  }

  private async mutate(
    operation: (file: { version: 1; units: TerminalAgentRecord[] }) => {
      version: 1
      units: TerminalAgentRecord[]
    }
  ): Promise<void> {
    return withManagerDataMutex('ade-terminal-agents', async () => {
      const file = await this.read()
      await writeAdeJson(filePath(this.deps.dataDir), operation(file))
    })
  }
}
