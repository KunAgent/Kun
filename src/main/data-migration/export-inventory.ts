import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { Stats } from 'node:fs'
import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import type { AppSettingsV1 } from '../../shared/app-settings'
import {
  classifyDataMigrationPath,
  parsePackageRelativePath,
  type DataMigrationEstimate,
  type DataMigrationPreset,
  type DataMigrationWorkspaceCatalogEntry,
  type PackageRelativePath
} from '../../shared/data-migration'
import type { Zip64ArchiveEntryInput } from './kunpack-zip'

export type DataMigrationWorkspaceCapability = 'code' | 'design' | 'write'

export type DataMigrationWorkspaceInventoryEntry = DataMigrationWorkspaceCatalogEntry & {
  canonicalPath: string
  capabilities: DataMigrationWorkspaceCapability[]
}

export type DataMigrationWorkspaceFile = {
  workspaceId: string
  relativePath: PackageRelativePath
  sourcePath: string
  logicalBytes: number
  mode: number
  modifiedAt: string
  sha256: string
}

export type DataMigrationFileInventory = {
  files: DataMigrationWorkspaceFile[]
  estimate: DataMigrationEstimate
  exclusionCounts: Record<string, number>
}

export async function discoverDataMigrationWorkspaces(input: {
  settings: AppSettingsV1
  runtimeThreads?: Array<{ id: string; workspace?: string }>
}): Promise<DataMigrationWorkspaceInventoryEntry[]> {
  const candidates = new Map<string, { displayPath: string; capabilities: Set<DataMigrationWorkspaceCapability>; threadIds: Set<string> }>()
  const add = (path: unknown, capability: DataMigrationWorkspaceCapability, threadId?: string) => {
    if (typeof path !== 'string' || !path.trim()) return
    const displayPath = expandHome(path.trim())
    const key = workspaceIdentityKey(displayPath)
    const existing = candidates.get(key) ?? { displayPath, capabilities: new Set(), threadIds: new Set() }
    existing.capabilities.add(capability)
    if (threadId) existing.threadIds.add(threadId)
    candidates.set(key, existing)
  }

  add(input.settings.workspaceRoot, 'code')
  add(input.settings.conversationWorkspaceRoot, 'code')
  add(input.settings.design.defaultWorkspaceRoot, 'design')
  add(input.settings.write.defaultWorkspaceRoot, 'write')
  add(input.settings.write.activeWorkspaceRoot, 'write')
  for (const root of input.settings.write.workspaces) add(root, 'write')
  add(input.settings.schedule.defaultWorkspaceRoot, 'code')
  for (const task of input.settings.schedule.tasks) add(task.workspaceRoot, 'code', task.lastThreadId || undefined)
  add(input.settings.workflow.defaultWorkspaceRoot, 'code')
  for (const root of collectStringFields(input.settings.workflow.workflows, 'workspaceRoot')) add(root, 'code')
  add(input.settings.claw.im.workspaceRoot, 'code')
  for (const channel of input.settings.claw.channels) {
    add(channel.workspaceRoot, 'code', channel.threadId || undefined)
    for (const conversation of channel.conversations) add(conversation.workspaceRoot, 'code', conversation.localThreadId || undefined)
  }
  for (const thread of input.runtimeThreads ?? []) add(thread.workspace, 'code', thread.id)

  const resolved = await Promise.all([...candidates.values()].map(async (candidate) => {
    const canonicalPath = await realpath(candidate.displayPath).catch(() => resolve(candidate.displayPath))
    return { ...candidate, canonicalPath }
  }))
  const byCanonical = new Map<string, typeof resolved[number]>()
  for (const candidate of resolved) {
    const key = workspaceIdentityKey(candidate.canonicalPath)
    const existing = byCanonical.get(key)
    if (existing) {
      for (const capability of candidate.capabilities) existing.capabilities.add(capability)
      for (const id of candidate.threadIds) existing.threadIds.add(id)
    } else {
      byCanonical.set(key, candidate)
    }
  }

  const roots = [...byCanonical.values()].sort((a, b) => a.canonicalPath.length - b.canonicalPath.length)
  const entries: DataMigrationWorkspaceInventoryEntry[] = roots.map((candidate) => ({
    workspaceId: workspaceId(candidate.canonicalPath),
    displayName: basename(candidate.displayPath) || candidate.displayPath,
    sourcePathDisplay: candidate.displayPath,
    sourcePlatform: sourcePlatform(),
    fileCount: 0,
    logicalBytes: 0,
    relatedThreadIds: [...candidate.threadIds].sort(),
    capabilities: [...candidate.capabilities].sort(),
    canonicalPath: candidate.canonicalPath
  }))
  for (const entry of entries) {
    const parent = entries
      .filter((candidate) => candidate.workspaceId !== entry.workspaceId && pathIsBelow(candidate.canonicalPath, entry.canonicalPath))
      .sort((a, b) => b.canonicalPath.length - a.canonicalPath.length)[0]
    if (parent) entry.nestedUnderWorkspaceId = parent.workspaceId
  }
  return entries
}

export async function inventoryDataMigrationFiles(input: {
  workspaces: readonly DataMigrationWorkspaceInventoryEntry[]
  preset: DataMigrationPreset
  sensitiveContentAcknowledged: boolean
  signal?: AbortSignal
  onProgress?: (progress: { files: number; bytes: number; path: string }) => void
}): Promise<DataMigrationFileInventory> {
  const files: DataMigrationWorkspaceFile[] = []
  const exclusions: DataMigrationEstimate['exclusions'] = []
  const sensitiveFindings: DataMigrationEstimate['sensitiveFindings'] = []
  const exclusionCounts: Record<string, number> = {}
  const childrenByParent = new Map<string, Set<string>>()
  let scannedBytes = 0
  for (const workspace of input.workspaces) {
    if (!workspace.nestedUnderWorkspaceId) continue
    const children = childrenByParent.get(workspace.nestedUnderWorkspaceId) ?? new Set<string>()
    children.add(workspace.canonicalPath)
    childrenByParent.set(workspace.nestedUnderWorkspaceId, children)
  }

  for (const workspace of input.workspaces) {
    input.signal?.throwIfAborted()
    const rootDetails = await lstat(workspace.canonicalPath).catch(() => null)
    if (!rootDetails?.isDirectory() || rootDetails.isSymbolicLink()) {
      exclusions.push({ scope: 'workspace', path: workspace.sourcePathDisplay, ruleId: 'workspace-unavailable', logicalBytes: 0 })
      exclusionCounts['workspace-unavailable'] = (exclusionCounts['workspace-unavailable'] ?? 0) + 1
      continue
    }
    const nestedRoots = childrenByParent.get(workspace.workspaceId) ?? new Set<string>()
    for await (const candidate of walkWorkspace(workspace.canonicalPath, nestedRoots, input.signal)) {
      const relativePath = normalizeRelativePath(relative(workspace.canonicalPath, candidate.path))
      const policy = classifyDataMigrationPath({ path: relativePath, scope: 'workspace', preset: input.preset })
      if (policy.action === 'hard-exclude' || policy.action === 'preset-exclude') {
        exclusions.push({ scope: 'workspace', path: relativePath, ruleId: policy.ruleId, logicalBytes: candidate.details.size })
        exclusionCounts[policy.ruleId] = (exclusionCounts[policy.ruleId] ?? 0) + 1
        continue
      }
      if (policy.action === 'require-sensitive-acknowledgement') {
        sensitiveFindings.push({ workspaceId: workspace.workspaceId, path: parsePackageRelativePath(relativePath), ruleId: policy.ruleId })
        if (!input.sensitiveContentAcknowledged) continue
      }
      const stable = await fingerprintStableFile(candidate.path, candidate.details)
      files.push({
        workspaceId: workspace.workspaceId,
        relativePath: parsePackageRelativePath(relativePath),
        sourcePath: candidate.path,
        logicalBytes: stable.size,
        mode: 0o100000 | (stable.mode & 0o777),
        modifiedAt: stable.mtime.toISOString(),
        sha256: stable.sha256
      })
      scannedBytes += stable.size
      input.onProgress?.({
        files: files.length,
        bytes: scannedBytes,
        path: candidate.path
      })
    }
  }

  files.sort((left, right) =>
    left.workspaceId.localeCompare(right.workspaceId) || left.relativePath.localeCompare(right.relativePath)
  )
  exclusions.sort((left, right) => left.path.localeCompare(right.path) || left.ruleId.localeCompare(right.ruleId))
  sensitiveFindings.sort((left, right) => left.path.localeCompare(right.path))

  const workspaceEstimates = input.workspaces.map((workspace) => {
    const owned = files.filter((file) => file.workspaceId === workspace.workspaceId)
    return {
      ...workspace,
      fileCount: owned.length,
      logicalBytes: owned.reduce((total, file) => total + file.logicalBytes, 0)
    }
  })
  const logicalBytes = files.reduce((total, file) => total + file.logicalBytes, 0)
  return {
    files,
    exclusionCounts,
    estimate: {
      workspaces: workspaceEstimates.map(({ canonicalPath: _canonicalPath, ...workspace }) => workspace),
      threadCount: new Set(workspaceEstimates.flatMap((workspace) => workspace.relatedThreadIds)).size,
      attachmentCount: 0,
      artifactCount: 0,
      memoryCount: 0,
      logicalBytes,
      estimatedPackageBytes: Math.ceil(logicalBytes * 0.75) + files.length * 256 + 64 * 1024,
      sensitiveFindings,
      exclusions
    }
  }
}

export function workspaceFilesToZipEntries(files: readonly DataMigrationWorkspaceFile[]): Zip64ArchiveEntryInput[] {
  return files.map((file) => ({
    path: parsePackageRelativePath(`payload/workspaces/${file.workspaceId}/files/${file.relativePath}`),
    kind: 'workspace-file',
    ownerId: file.workspaceId,
    source: { kind: 'file', path: file.sourcePath },
    logicalBytes: file.logicalBytes,
    sha256: file.sha256,
    mode: file.mode,
    modifiedAt: file.modifiedAt
  }))
}

export function portableSettingsForMigration(settings: AppSettingsV1): Record<string, unknown> {
  return {
    schemaVersion: 1,
    locale: settings.locale,
    theme: settings.theme,
    uiFontScale: settings.uiFontScale,
    chatContentMaxWidthPx: settings.chatContentMaxWidthPx,
    cursorSpotlight: settings.cursorSpotlight,
    cursorSpotlightColor: settings.cursorSpotlightColor,
    notifications: settings.notifications,
    appBehavior: { closeAction: settings.appBehavior.closeAction },
    gitBranchPrefix: settings.gitBranchPrefix,
    codePromptPrefix: settings.codePromptPrefix,
    disabledSkillIds: settings.disabledSkillIds,
    write: {
      autoSaveEnabled: settings.write.autoSaveEnabled,
      autoSaveDelayMs: settings.write.autoSaveDelayMs,
      typography: settings.write.typography,
      agentPresets: settings.write.agentPresets
    },
    design: {
      brandColor: settings.design.brandColor,
      tone: settings.design.tone,
      designSystemPreset: settings.design.designSystemPreset,
      designType: settings.design.designType,
      designGuidelines: settings.design.designGuidelines,
      radius: settings.design.radius,
      density: settings.design.density,
      fontStyle: settings.design.fontStyle,
      implementStackHint: settings.design.implementStackHint,
      injectIntoCode: settings.design.injectIntoCode,
      publishDesignSystem: settings.design.publishDesignSystem,
      defaultViewport: settings.design.defaultViewport,
      defaultCanvasView: settings.design.defaultCanvasView,
      canvasBackground: settings.design.canvasBackground,
      liveRefresh: settings.design.liveRefresh,
      deviceFrame: settings.design.deviceFrame
    }
  }
}

export function sanitizedAutomationsForMigration(settings: AppSettingsV1): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workflows: settings.workflow.workflows.map((workflow) => sanitizeAutomationValue({ ...workflow, enabled: false })),
    schedules: settings.schedule.tasks.map((task) => ({
      ...sanitizeRecord(sanitizeAutomationValue(task)),
      enabled: false,
      clawChannelId: '',
      lastThreadId: '',
      lastRunAt: '',
      nextRunAt: '',
      lastStatus: 'idle',
      lastMessage: ''
    }))
  }
}

export function assertMigrationOutputOutsideWorkspaces(outputPath: string, workspaces: readonly DataMigrationWorkspaceInventoryEntry[]): void {
  const output = resolve(outputPath)
  for (const workspace of workspaces) {
    const displayRoot = resolve(workspace.sourcePathDisplay)
    if (
      output === workspace.canonicalPath ||
      pathIsBelow(workspace.canonicalPath, output) ||
      output === displayRoot ||
      pathIsBelow(displayRoot, output)
    ) {
      throw new Error(`migration output cannot be placed inside a selected workspace: ${workspace.sourcePathDisplay}`)
    }
  }
  if (output.split(sep).some((segment) => segment === '.kun-migration-staging' || segment === '.kun-migration-backup')) {
    throw new Error('migration output cannot be placed inside a migration staging or backup directory')
  }
}

async function *walkWorkspace(
  root: string,
  nestedRoots: ReadonlySet<string>,
  signal?: AbortSignal
): AsyncGenerator<{ path: string; details: Stats }> {
  const pending = [root]
  while (pending.length > 0) {
    signal?.throwIfAborted()
    const directory = pending.pop()!
    const handle = await opendir(directory)
    for await (const entry of handle) {
      signal?.throwIfAborted()
      const path = resolve(directory, entry.name)
      if (nestedRoots.has(path)) continue
      const details = await lstat(path)
      if (details.isSymbolicLink()) continue
      if (details.isDirectory()) {
        pending.push(path)
      } else if (details.isFile()) {
        yield { path, details }
      }
    }
  }
}

async function fingerprintStableFile(path: string, before: Stats) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = attempt === 0 ? before : await stat(path)
    const sha256 = await hashFile(path)
    const after = await stat(path)
    if (sameFileIdentity(current, after)) {
      return { size: after.size, mode: after.mode, mtime: after.mtime, sha256 }
    }
  }
  throw new Error(`workspace file changed repeatedly during migration scan: ${path}`)
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function workspaceId(path: string): string {
  return `ws_${createHash('sha256').update(workspaceIdentityKey(path)).digest('hex').slice(0, 24)}`
}

function workspaceIdentityKey(path: string): string {
  const normalized = resolve(path).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized
}

function pathIsBelow(parent: string, child: string): boolean {
  const candidate = relative(parent, child)
  return Boolean(candidate) && !candidate.startsWith('..') && !isAbsolute(candidate)
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/')
}

function collectStringFields(value: unknown, field: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => collectStringFields(item, field))
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [
    ...(typeof record[field] === 'string' ? [record[field] as string] : []),
    ...Object.values(record).flatMap((item) => collectStringFields(item, field))
  ]
}

function sanitizeAutomationValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeAutomationValue)
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(?:secret|token|credential|apiKey|accountId|providerId|channelId|webhookSecret)/i.test(key)) continue
    output[key] = key === 'enabled' || key === 'active' ? false : sanitizeAutomationValue(child)
  }
  return output
}

function sanitizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function sourcePlatform(): 'windows' | 'macos' | 'linux' {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'
}

function expandHome(path: string): string {
  if (path === '~' || path.startsWith('~/') || path.startsWith('~\\')) {
    return path === '~' ? homedir() : resolve(homedir(), path.slice(2))
  }
  return resolve(path)
}
