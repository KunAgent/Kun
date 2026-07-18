import type {
  DataMigrationRendererRequest,
  DataMigrationRendererResponse,
  ImportedWorkspaceTrustReset,
  RestoredRendererState
} from '@shared/data-migration'
import {
  designDocKey,
  normalizeDesignThreadRegistry,
  readDesignThreadRegistry,
  saveDesignThreadRegistry,
  splitDesignDocKey
} from '../design/design-thread-registry'
import {
  normalizeWriteThreadRegistry,
  readWriteThreadRegistry,
  saveWriteThreadRegistry
} from '../write/write-thread-registry'
import {
  normalizeSddThreadRegistry,
  readSddThreadRegistry,
  saveSddThreadRegistry
} from '../sdd/sdd-thread-registry'
import {
  normalizeThreadForkRegistry,
  readThreadForkRegistry,
  saveThreadForkRegistry
} from '../lib/thread-fork-registry'
import { readCodeWorkspaceRoots, saveCodeWorkspaceRoots } from '../store/chat-store-helpers'

const PLAN_REGISTRY_STORAGE_KEY = 'kun.plan.registry.v1'
const THREAD_COMPOSER_MODE_STORAGE_KEY = 'kun.threadComposerMode.v1'
const MIGRATION_TRUST_STORAGE_KEY = 'kun.dataMigration.workspaceTrust.v1'

export function installDataMigrationRendererRpc(): () => void {
  if (!window.kunGui?.dataMigration?.onRendererRequest) return () => undefined
  return window.kunGui.dataMigration.onRendererRequest((request) => {
    void handleRequest(request).then(
      (value) => respond({ requestId: request.requestId, ok: true, value }),
      (error) => respond({
        requestId: request.requestId,
        ok: false,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
      })
    )
  })
}

async function handleRequest(request: DataMigrationRendererRequest): Promise<unknown> {
  switch (request.action) {
    case 'capture-state':
      return captureRendererMigrationState()
    case 'replace-state':
      replaceRendererMigrationState(normalizeState(request.payload))
      return true
    case 'capture-trust':
      return captureTrustResets(Array.isArray(request.payload) ? request.payload.filter(isString) : [])
    case 'apply-trust':
      applyTrustResetSnapshot(normalizeTrustResetSnapshot(request.payload))
      return true
    case 'refresh':
      window.dispatchEvent(new CustomEvent('kun:data-migration-refresh'))
      setTimeout(() => window.location.reload(), 50)
      return true
  }
}

export function captureRendererMigrationState(): RestoredRendererState {
  const design = Object.entries(readDesignThreadRegistry().workspaces).flatMap(([scope, record]) => {
    const split = splitDesignDocKey(scope)
    const workspaceRoot = split?.workspaceRoot ?? scope
    const docId = split?.docId ?? ''
    return record.threadIds.map((threadId) => ({
      workspaceRoot,
      docId,
      threadId,
      active: threadId === record.activeThreadId
    }))
  })
  const write = Object.entries(readWriteThreadRegistry().workspaces).flatMap(([workspaceRoot, record]) =>
    record.threadIds.map((threadId) => ({
      workspaceRoot,
      threadId,
      active: threadId === record.activeThreadId,
      filePaths: Object.entries(record.fileThreadIds).flatMap(([path, id]) => id === threadId ? [path] : [])
    }))
  )
  const plans = Object.values(readJsonRecord(PLAN_REGISTRY_STORAGE_KEY).plans ?? {}).filter(isRecord)
  const sdd = Object.values(readSddThreadRegistry().drafts)
  const forks = Object.entries(readThreadForkRegistry().forks).map(([threadId, record]) => ({ threadId, ...record }))
  const modes = Object.entries(readJsonRecord(THREAD_COMPOSER_MODE_STORAGE_KEY)).map(([threadId, mode]) => ({ threadId, mode }))
  return {
    schemaVersion: 1,
    design,
    write,
    plans,
    sdd,
    forks,
    threads: [],
    composer: { modes },
    workspaces: readCodeWorkspaceRoots().map((workspaceRoot) => ({ workspaceRoot })),
    unresolvedReferences: []
  }
}

export function replaceRendererMigrationState(state: RestoredRendererState): void {
  const designWorkspaces: Record<string, { activeThreadId: string; threadIds: string[] }> = {}
  for (const value of state.design) {
    const item = isRecord(value) ? value : {}
    if (!isString(item.workspaceRoot) || !isString(item.threadId)) continue
    const key = designDocKey(item.workspaceRoot, isString(item.docId) ? item.docId : '')
    const record = designWorkspaces[key] ?? { activeThreadId: '', threadIds: [] }
    if (!record.threadIds.includes(item.threadId)) record.threadIds.push(item.threadId)
    if (item.active === true || !record.activeThreadId) record.activeThreadId = item.threadId
    designWorkspaces[key] = record
  }
  saveDesignThreadRegistry(normalizeDesignThreadRegistry({ version: 1, workspaces: designWorkspaces }))

  const writeWorkspaces: Record<string, { activeThreadId: string; threadIds: string[]; fileThreadIds: Record<string, string> }> = {}
  for (const value of state.write) {
    const item = isRecord(value) ? value : {}
    if (!isString(item.workspaceRoot) || !isString(item.threadId)) continue
    const record = writeWorkspaces[item.workspaceRoot] ?? { activeThreadId: '', threadIds: [], fileThreadIds: {} }
    if (!record.threadIds.includes(item.threadId)) record.threadIds.push(item.threadId)
    if (item.active === true || !record.activeThreadId) record.activeThreadId = item.threadId
    if (Array.isArray(item.filePaths)) {
      for (const path of item.filePaths) if (isString(path)) record.fileThreadIds[path] = item.threadId
    }
    writeWorkspaces[item.workspaceRoot] = record
  }
  saveWriteThreadRegistry(normalizeWriteThreadRegistry({ version: 1, workspaces: writeWorkspaces }))

  const drafts = Object.fromEntries(state.sdd.flatMap((value) => {
    const item = isRecord(value) ? value : {}
    return isString(item.draftId) ? [[item.draftId, item]] : []
  }))
  saveSddThreadRegistry(normalizeSddThreadRegistry({ version: 1, drafts }))

  const forks = Object.fromEntries(state.forks.flatMap((value) => {
    const item = isRecord(value) ? value : {}
    if (!isString(item.threadId) || !isString(item.parentThreadId)) return []
    const { threadId: _threadId, ...record } = item
    return [[item.threadId, record]]
  }))
  saveThreadForkRegistry(normalizeThreadForkRegistry({ version: 1, forks }))

  const plans = Object.fromEntries(state.plans.flatMap((value) => {
    const item = isRecord(value) ? value : {}
    return isString(item.id) ? [[item.id, item]] : []
  }))
  const activeByWorkspace: Record<string, string> = {}
  const activeByThread: Record<string, string> = {}
  for (const plan of Object.values(plans)) {
    if (isString(plan.workspaceRoot)) activeByWorkspace[plan.workspaceRoot] = plan.id as string
    if (isString(plan.workspaceRoot) && isString(plan.threadId)) {
      activeByThread[`${plan.workspaceRoot}::${plan.threadId}`] = plan.id as string
    }
  }
  writeJson(PLAN_REGISTRY_STORAGE_KEY, { version: 1, activeByWorkspace, activeByThread, plans })

  const modes = Array.isArray(state.composer.modes) ? state.composer.modes : []
  writeJson(THREAD_COMPOSER_MODE_STORAGE_KEY, Object.fromEntries(modes.flatMap((value) => {
    const item = isRecord(value) ? value : {}
    return isString(item.threadId) && isString(item.mode) ? [[item.threadId, item.mode]] : []
  })))
  saveCodeWorkspaceRoots(state.workspaces.flatMap((value) => {
    const item = isRecord(value) ? value : {}
    return isString(item.workspaceRoot) ? [item.workspaceRoot] : []
  }))
}

export function captureTrustResets(workspaceRoots: string[]): ImportedWorkspaceTrustReset[] {
  const registry = readJsonRecord(MIGRATION_TRUST_STORAGE_KEY)
  return workspaceRoots.flatMap((workspaceRoot) => {
    const value = registry[workspaceRoot]
    return isTrustReset(value) ? [value] : []
  })
}

export function applyTrustResetSnapshot(input: {
  workspaceRoots: string[]
  resets: ImportedWorkspaceTrustReset[]
}): void {
  const registry = readJsonRecord(MIGRATION_TRUST_STORAGE_KEY)
  for (const workspaceRoot of input.workspaceRoots) delete registry[workspaceRoot]
  for (const reset of input.resets) registry[reset.workspaceRoot] = reset
  writeJson(MIGRATION_TRUST_STORAGE_KEY, registry)
}

function normalizeState(value: unknown): RestoredRendererState {
  const record = isRecord(value) ? value : {}
  const array = (key: string) => Array.isArray(record[key]) ? record[key] as unknown[] : []
  return {
    schemaVersion: 1,
    design: array('design'), write: array('write'), plans: array('plans'), sdd: array('sdd'),
    forks: array('forks'), threads: array('threads'), workspaces: array('workspaces'),
    composer: isRecord(record.composer) ? record.composer : {},
    unresolvedReferences: Array.isArray(record.unresolvedReferences)
      ? record.unresolvedReferences.filter(isUnresolvedReference)
      : []
  }
}

export function normalizeTrustResetSnapshot(value: unknown): {
  workspaceRoots: string[]
  resets: ImportedWorkspaceTrustReset[]
} {
  if (Array.isArray(value)) {
    const resets = value.filter(isTrustReset)
    return { workspaceRoots: resets.map((item) => item.workspaceRoot), resets }
  }
  const record = isRecord(value) ? value : {}
  const workspaceRoots = Array.isArray(record.workspaceRoots) ? record.workspaceRoots.filter(isString) : []
  const resets = Array.isArray(record.resets) ? record.resets.filter(isTrustReset) : []
  const allowedRoots = new Set(workspaceRoots)
  if (resets.some((reset) => !allowedRoots.has(reset.workspaceRoot))) {
    throw new Error('trust reset snapshot contains an out-of-scope workspace')
  }
  return { workspaceRoots: [...new Set(workspaceRoots)], resets }
}

function isTrustReset(value: unknown): value is ImportedWorkspaceTrustReset {
  return isRecord(value) && isString(value.workspaceRoot) && value.trusted === false &&
    Array.isArray(value.disabledCapabilities) && value.disabledCapabilities.every(isString)
}

function isUnresolvedReference(value: unknown): value is { pointer: string; originalValue: string } {
  return isRecord(value) && isString(value.pointer) && isString(value.originalValue)
}

function readJsonRecord(key: string): Record<string, unknown> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '{}')
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function respond(response: DataMigrationRendererResponse): Promise<void> {
  return window.kunGui.dataMigration.respondRendererRequest(response)
}
