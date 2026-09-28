import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AgentIdentity } from '../contracts/agent-identities.js'
import type { Room } from '../contracts/rooms.js'
import { kunToolPermissionModeFromSettings, kunToolPermissionModeSettings, type KunToolPermissionMode } from '../contracts/policy.js'
import { resolveWorkbenchPolicy, type AgentWorkbenchPolicy } from '../contracts/workbench-policy.js'
import type { ThreadStore } from '../ports/thread-store.js'
import type { ProjectBoardService } from '../services/project-board-service.js'
import type { RoomRuntimeDeps } from '../rooms/room-runtime-types.js'
import type { RoomService } from '../rooms/room-service.js'
import type { RoomStore } from '../rooms/room-store.js'
import type { TaskWorkspaceService } from '../workspace-tasks/task-workspace-service.js'
import { WorkbenchDirectoryService, pathWithin } from './directory.js'

export type WorkbenchExternalServices = {
  taskWorkspaces?: TaskWorkspaceService
  projectBoard?: ProjectBoardService
}

/** What an Agent identity currently allows; read live so a settings change applies to the next tool call. */
export type WorkbenchAgentScope = {
  agentId: string
  name: string
  policy: AgentWorkbenchPolicy
  /** Directories the Agent is limited to; undefined means no limit. */
  allowedRoots?: string[]
}

export type KnownCodeProject = { path: string; name: string; threads: number; lastActiveAt?: string }

const RANK: Record<KunToolPermissionMode, number> = { 'ask-for-approval': 0, 'approve-for-me': 1, 'full-access': 2 }

/**
 * Owner of the Code/Work bridge: durable links, the directory of workspaces,
 * task start-up and outcome reconciliation. One instance per Room runtime.
 */
export class WorkbenchBridge {
  readonly directory: WorkbenchDirectoryService
  private external: WorkbenchExternalServices = {}
  /** Finished links whose outcome still has to reach the Agent; rebuilt from the store after a restart. */
  readonly reportPending = new Set<string>()
  backlogLoaded = false
  constructor(readonly deps: RoomRuntimeDeps, readonly service: RoomService, readonly wake: () => void) {
    this.directory = WorkbenchDirectoryService.forDataDir(deps.dataDir)
  }

  attach(external: WorkbenchExternalServices): void { this.external = { ...this.external, ...external } }
  get taskWorkspaces(): TaskWorkspaceService | undefined { return this.external.taskWorkspaces }
  get projectBoard(): ProjectBoardService | undefined { return this.external.projectBoard }
  get store(): RoomStore { return this.deps.store }

  async agentScope(agentId: string): Promise<WorkbenchAgentScope> {
    const row = await this.deps.store.get<AgentIdentity>('agent_identity', agentId)
    if (!row || row.value.archivedAt) throw new Error('the Agent is unavailable')
    return { agentId, name: row.value.name, policy: resolveWorkbenchPolicy(row.value.workbench),
      ...(row.value.allowedRepositoryRoots ? { allowedRoots: row.value.allowedRepositoryRoots } : {}) }
  }

  /** Whether `path` lies inside one of the Agent's allowed directories (always true without limits). */
  static withinAgentLimits(scope: Pick<WorkbenchAgentScope, 'allowedRoots'>, path: string): boolean {
    return !scope.allowedRoots || scope.allowedRoots.some((root) => pathWithin(root, path))
  }

  /**
   * Code projects the user actually uses: workspaces of their primary Code
   * threads plus anything the desktop shell registered. Room-owned threads are
   * side threads and never appear in the listing.
   */
  async knownCodeProjects(scope: Pick<WorkbenchAgentScope, 'allowedRoots'>): Promise<KnownCodeProject[]> {
    const summaries = await this.deps.threads.list({ limit: 2000 })
    const byPath = new Map<string, KnownCodeProject>()
    for (const thread of summaries) {
      if (thread.agentSurface !== 'code' || thread.workspaceMode === 'ade' || thread.taskWorkspaceId ||
        thread.status === 'archived' || thread.status === 'deleted') continue
      const path = thread.workspace
      const existing = byPath.get(path)
      byPath.set(path, { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
        threads: (existing?.threads ?? 0) + 1,
        lastActiveAt: !existing?.lastActiveAt || thread.updatedAt > existing.lastActiveAt ? thread.updatedAt : existing.lastActiveAt })
    }
    for (const path of (await this.directory.get()).codeProjects) {
      if (!byPath.has(path)) byPath.set(path, { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path, threads: 0 })
    }
    return [...byPath.values()].filter((project) => WorkbenchBridge.withinAgentLimits(scope, project.path))
      .sort((a, b) => (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || a.name.localeCompare(b.name))
  }

  /** Canonical existing directory, or undefined. */
  async resolveDirectory(path: string): Promise<string | undefined> {
    try {
      const real = await realpath(resolve(path))
      return (await stat(real)).isDirectory() ? real : undefined
    } catch { return undefined }
  }

  /**
   * Authority a task may run with: the Code default, never wider than the
   * Agent's own private permission mode. Returns the mode to force, or
   * undefined when the thread default is already within the ceiling.
   */
  async permissionCeiling(roomId: string, threadDefaults: Parameters<typeof kunToolPermissionModeFromSettings>[0]):
    Promise<ReturnType<typeof kunToolPermissionModeSettings> | undefined> {
    const room = (await this.deps.store.get<Room>('room', roomId))?.value
    const member = room?.members.find((item) => item.id === room.defaultMemberId)
    const agent = member?.participantAgentId
      ? (await this.deps.store.get<AgentIdentity>('agent_identity', member.participantAgentId))?.value : undefined
    const restricted = member?.presetSnapshot?.toolPolicy === 'readOnly' || agent?.allowedRepositoryRoots !== undefined ||
      this.deps.profiles()[member?.presetId ?? '']?.toolPolicy === 'readOnly'
    const agentPolicy = room?.privateExecutionPolicy ?? kunToolPermissionModeSettings(restricted ? 'ask-for-approval' : 'full-access')
    const ceiling = kunToolPermissionModeFromSettings(agentPolicy)
    const current = kunToolPermissionModeFromSettings(threadDefaults)
    return RANK[current] > RANK[ceiling] ? kunToolPermissionModeSettings(ceiling) : undefined
  }
}

const bridges = new WeakMap<ThreadStore, WorkbenchBridge>()
export function bindWorkbenchBridge(threads: ThreadStore, bridge: WorkbenchBridge): void { bridges.set(threads, bridge) }
export function workbenchBridgeBinding(threads: ThreadStore): WorkbenchBridge | undefined { return bridges.get(threads) }
