import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  COLAB_ACCELERATOR_SPECS,
  normalizeColabAccelerator,
  parseKnownColabAccelerator,
  type ColabAccelerator,
  type ColabConnectionOccupancy,
  type ColabConnectionStatus,
  type ColabConnectionView,
  type ColabLastRunSummary,
  type ColabSessionView,
  type ColabUntrackedSession
} from '../../shared/colab/colab-types'
import { atomicWriteFile } from '../atomic-json-file'

const AVATAR_PALETTE = ['#5b78ff', '#7a68e8', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899']

export type PersistedConnectionRecord = {
  id: string
  name: string
  email: string
  avatarColor: string
  planLabel: string
  balanceCu: number | null
  burnRateCuPerHour: number | null
  eligibleAccelerators?: ColabAccelerator[]
  ineligibleAccelerators?: ColabAccelerator[]
  status: ColabConnectionStatus
  createdAt: string
  updatedAt: string
}

export type PersistedColabState = {
  version: 1
  connections: PersistedConnectionRecord[]
  workspaceConnections: Record<string, string>
  lastRunsByWorkspace: Record<string, ColabLastRunSummary>
  ignoredUntrackedKeys: string[]
}

export function normalizeWorkspaceKey(workspaceRoot: string): string {
  return workspaceRoot.trim().replace(/[\\/]+$/, '')
}

export function workspaceShortLabel(workspaceRoot: string): string {
  const cleaned = normalizeWorkspaceKey(workspaceRoot)
  return cleaned ? basename(cleaned) : 'workspace'
}

export function pickAvatarColor(index: number): string {
  return AVATAR_PALETTE[index % AVATAR_PALETTE.length] ?? '#5b78ff'
}

export function isActiveColabSessionPhase(phase: ColabSessionView['phase']): boolean {
  return ['provisioning', 'uploading', 'installing', 'running', 'disconnected'].includes(phase)
}

export async function loadColabPersistedState(statePath: string): Promise<{
  connections: PersistedConnectionRecord[]
  workspaceConnections: Record<string, string>
  lastRunsByWorkspace: Record<string, ColabLastRunSummary>
  ignoredUntrackedKeys: Set<string>
}> {
  if (!existsSync(statePath)) {
    return {
      connections: [],
      workspaceConnections: {},
      lastRunsByWorkspace: {},
      ignoredUntrackedKeys: new Set()
    }
  }
  try {
    const parsed = JSON.parse(await readFile(statePath, 'utf8')) as Partial<PersistedColabState>
    const sanitizeAccelList = (list: unknown): ColabAccelerator[] | undefined => {
      if (!Array.isArray(list)) return undefined
      return list
        .map((item) => parseKnownColabAccelerator(item))
        .filter((item): item is ColabAccelerator => item !== null)
    }
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections.map((rec) => {
          const eligible = sanitizeAccelList(rec.eligibleAccelerators)
          const ineligible = sanitizeAccelList(rec.ineligibleAccelerators)
          return {
            ...rec,
            ...(eligible ? { eligibleAccelerators: eligible } : {}),
            ...(ineligible ? { ineligibleAccelerators: ineligible } : {})
          }
        })
      : []
    const lastRunsByWorkspace: Record<string, ColabLastRunSummary> = {}
    if (parsed.lastRunsByWorkspace && typeof parsed.lastRunsByWorkspace === 'object') {
      for (const [ws, summary] of Object.entries(parsed.lastRunsByWorkspace)) {
        if (!summary || typeof summary !== 'object') continue
        lastRunsByWorkspace[ws] = {
          ...summary,
          accelerator: normalizeColabAccelerator(summary.accelerator, 'T4')
        }
      }
    }
    return {
      connections,
      workspaceConnections:
        parsed.workspaceConnections && typeof parsed.workspaceConnections === 'object'
          ? { ...parsed.workspaceConnections }
          : {},
      lastRunsByWorkspace,
      ignoredUntrackedKeys: new Set(
        Array.isArray(parsed.ignoredUntrackedKeys) ? parsed.ignoredUntrackedKeys : []
      )
    }
  } catch {
    return {
      connections: [],
      workspaceConnections: {},
      lastRunsByWorkspace: {},
      ignoredUntrackedKeys: new Set()
    }
  }
}

export async function saveColabPersistedState(
  statePath: string,
  state: {
    connections: PersistedConnectionRecord[]
    workspaceConnections: Record<string, string>
    lastRunsByWorkspace: Record<string, ColabLastRunSummary>
    ignoredUntrackedKeys: Set<string>
  }
): Promise<void> {
  const payload: PersistedColabState = {
    version: 1,
    connections: state.connections,
    workspaceConnections: state.workspaceConnections,
    lastRunsByWorkspace: state.lastRunsByWorkspace,
    ignoredUntrackedKeys: [...state.ignoredUntrackedKeys].slice(-100)
  }
  await atomicWriteFile(statePath, `${JSON.stringify(payload, null, 2)}\n`)
}

export function buildColabConnectionView(
  rec: PersistedConnectionRecord,
  sessions: Iterable<ColabSessionView>
): ColabConnectionView {
  const activeSessions: ColabConnectionOccupancy[] = []
  for (const s of sessions) {
    if (s.connectionId === rec.id && isActiveColabSessionPhase(s.phase)) {
      activeSessions.push({
        sessionId: s.id,
        sessionName: s.sessionName,
        workspaceRoot: s.workspaceRoot,
        workspaceLabel: workspaceShortLabel(s.workspaceRoot),
        accelerator: s.accelerator,
        phase: s.phase
      })
    }
  }
  return { ...rec, activeSessions }
}

export function buildAdoptedSessionView(
  item: ColabUntrackedSession,
  conn: PersistedConnectionRecord,
  workspaceRoot: string
): ColabSessionView {
  const spec = COLAB_ACCELERATOR_SPECS[item.accelerator]
  return {
    id: `csess-${randomUUID().slice(0, 8)}`,
    sessionName: item.remoteLabel,
    endpoint: item.endpoint,
    connectionId: conn.id,
    connectionName: conn.name,
    connectionEmail: conn.email,
    connectionAvatarColor: conn.avatarColor,
    workspaceRoot: normalizeWorkspaceKey(workspaceRoot),
    accelerator: item.accelerator,
    ...(item.highMem ? { highMem: true } : {}),
    vramGb: spec.vramGb,
    ramGb: spec.ramGb,
    phase: 'running',
    provisioningStep: 'start',
    startedAt: item.detectedAt,
    elapsedSeconds: 0,
    entryCommand: '(adopted remote session)',
    syncPaths: [],
    outputRemoteDir: 'outputs/',
    outputLocalDir: './outputs',
    maxRuntimeHours: 0,
    autoStop: false,
    mountDrive: false,
    consumedCu: 0,
    burnRateCuPerHour: spec.estimatedCuPerHour,
    estimatedTotalCu: 0,
    uploadTransferredBytes: 0,
    uploadTotalBytes: 0,
    gpuUtilizationPct: null,
    vramUsedGb: null,
    gpuHistory: [],
    metrics: {},
    logTail: [`[colab] 已接管远端会话 ${item.endpoint}`],
    artifacts: []
  }
}
