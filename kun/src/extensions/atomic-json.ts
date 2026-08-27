import { readFile, rm } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { z } from 'zod'
import { atomicWriteFile } from '../adapters/file/atomic-write.js'
import {
  currentManagerDataCommitId,
  currentManagerDataMutexContext
} from '../manager/data-mutex-context.js'
import { extensionError } from './errors.js'
import type { ManagerResourceFence } from '../manager/resource-lease-state.js'

export type AtomicJsonMutationOptions = {
  signal?: AbortSignal
  fence?: ManagerResourceFence
  commitId?: string
}

export type JsonValidator<T> = (value: unknown) => T

export class AtomicJsonFile<T> {
  private operation: Promise<unknown> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly validate: JsonValidator<T>,
    private readonly allowDirectWriteFallback = true
  ) {}

  async read(fallback: () => T): Promise<T> {
    const manager = managerAtomicJsonConfig(this.path)
    if (manager) {
      const snapshot = await readManagerSnapshot(manager, this.path)
      return snapshot.value === null ? fallback() : this.validate(snapshot.value)
    }
    try {
      const contents = await readFile(this.path, 'utf8')
      return this.validate(JSON.parse(contents) as unknown)
    } catch (error) {
      if (isMissingFile(error)) return fallback()
      if (error instanceof SyntaxError) {
        throw extensionError('EXTENSION_JSON_INVALID', 'Persisted extension JSON is malformed', {
          path: this.path
        }, error)
      }
      throw error
    }
  }

  async write(value: T, options: AtomicJsonMutationOptions = {}): Promise<void> {
    options = mutationOptions(options)
    const validated = this.validate(value)
    const manager = managerAtomicJsonConfig(this.path)
    if (manager) {
      await this.serialize(async () => {
        for (let attempt = 0; attempt < MAX_MANAGER_WRITE_ATTEMPTS; attempt += 1) {
          const snapshot = await readManagerSnapshot(manager, this.path)
          const written = await writeManagerSnapshot(
            manager,
            this.path,
            snapshot.revision,
            validated,
            options
          )
          if (written) return
        }
        throw managerConflictError(this.path)
      })
      return
    }
    options.signal?.throwIfAborted()
    await atomicWriteFile(this.path, `${JSON.stringify(validated, null, 2)}\n`, {
      signal: options.signal,
      allowDirectWriteFallback: this.allowDirectWriteFallback
    })
  }

  async update(
    fallback: () => T,
    mutate: (current: T) => T | Promise<T>,
    options: AtomicJsonMutationOptions = {}
  ): Promise<T> {
    options = mutationOptions(options)
    return this.serialize(async () => {
      const manager = managerAtomicJsonConfig(this.path)
      if (manager) {
        for (let attempt = 0; attempt < MAX_MANAGER_WRITE_ATTEMPTS; attempt += 1) {
          const snapshot = await readManagerSnapshot(manager, this.path)
          const current = snapshot.value === null ? fallback() : this.validate(snapshot.value)
          const next = this.validate(await mutate(current))
          if (await writeManagerSnapshot(
            manager, this.path, snapshot.revision, next, options
          )) return next
        }
        throw managerConflictError(this.path)
      }
      const current = await this.read(fallback)
      const next = this.validate(await mutate(current))
      await this.write(next, options)
      return next
    })
  }

  async delete(options: AtomicJsonMutationOptions = {}): Promise<void> {
    options = mutationOptions(options)
    const manager = managerAtomicJsonConfig(this.path)
    if (manager) {
      await this.serialize(async () => {
        for (let attempt = 0; attempt < MAX_MANAGER_WRITE_ATTEMPTS; attempt += 1) {
          const snapshot = await readManagerSnapshot(manager, this.path)
          if (await deleteManagerSnapshot(
            manager, this.path, snapshot.revision, options
          )) return
        }
        throw managerConflictError(this.path)
      })
      return
    }
    options.signal?.throwIfAborted()
    await rm(this.path, { force: true })
  }

  private serialize<R>(operation: () => Promise<R>): Promise<R> {
    const result = this.operation.then(operation, operation)
    this.operation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

const MAX_MANAGER_WRITE_ATTEMPTS = 8

export type ManagerAtomicJsonConfig = {
  baseUrl: string
  token: string
  dataDir: string
}

let explicitManagerAtomicJsonConfig: ManagerAtomicJsonConfig | null = null

/**
 * Configures this process as a Manager data-plane client without putting the
 * Manager bearer token in process.env (and therefore in spawned child envs).
 * Runtime processes keep using their explicitly scoped launch environment.
 */
export function configureManagerAtomicJsonClient(
  config: ManagerAtomicJsonConfig | null
): void {
  explicitManagerAtomicJsonConfig = config
    ? {
        baseUrl: config.baseUrl.replace(/\/+$/u, ''),
        token: config.token,
        dataDir: resolve(config.dataDir)
      }
    : null
}

type ManagerAtomicJsonSnapshot = {
  revision: number
  value: unknown | null
}

const ManagerAtomicJsonSnapshotSchema = z.object({
  snapshot: z.object({
    revision: z.number().int().nonnegative(),
    value: z.unknown().nullable()
  })
})

function managerAtomicJsonConfig(path: string): ManagerAtomicJsonConfig | null {
  const baseUrl = explicitManagerAtomicJsonConfig?.baseUrl ?? process.env.KUN_MANAGER_BASE_URL?.trim()
  const token = explicitManagerAtomicJsonConfig?.token ?? process.env.KUN_MANAGER_TOKEN?.trim()
  const configuredDataDir = explicitManagerAtomicJsonConfig?.dataDir ??
    process.env.KUN_MANAGER_DATA_DIR?.trim()
  if (!baseUrl || !token || !configuredDataDir) return null
  const dataDir = resolve(configuredDataDir)
  const target = resolve(path)
  const pathRelative = relative(dataDir, target)
  const sharedMcpPath = resolve(dataDir, '..', 'mcp.json')
  if (
    (target !== sharedMcpPath && (
        !pathRelative ||
        pathRelative === '.' ||
        pathRelative === '..' ||
        pathRelative.startsWith(`..${sep}`)
      )) ||
    !/\.json$/iu.test(target)
  ) return null
  return { baseUrl: baseUrl.replace(/\/+$/u, ''), token, dataDir }
}

export function isManagerAtomicJsonPath(path: string): boolean {
  return managerAtomicJsonConfig(path) !== null
}

/** Prevent security-sensitive stores from silently falling back to local RMW. */
export function assertManagerAtomicJsonPath(path: string): void {
  const managerConfigured = Boolean(
    (explicitManagerAtomicJsonConfig?.baseUrl ?? process.env.KUN_MANAGER_BASE_URL?.trim()) &&
    (explicitManagerAtomicJsonConfig?.token ?? process.env.KUN_MANAGER_TOKEN?.trim()) &&
    (explicitManagerAtomicJsonConfig?.dataDir ?? process.env.KUN_MANAGER_DATA_DIR?.trim())
  )
  if (managerConfigured && !managerAtomicJsonConfig(path)) {
    throw extensionError(
      'EXTENSION_JSON_MANAGER_PATH_MISMATCH',
      'Persisted Registry path is outside the configured Manager data directory',
      { path }
    )
  }
}

async function readManagerSnapshot(
  manager: ManagerAtomicJsonConfig,
  path: string
): Promise<ManagerAtomicJsonSnapshot> {
  const response = await fetch(`${manager.baseUrl}/v1/data/atomic-json/read`, {
    method: 'POST',
    headers: managerHeaders(manager.token),
    body: JSON.stringify({ path }),
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw await managerRequestError(response, path)
  return ManagerAtomicJsonSnapshotSchema.parse(await response.json()).snapshot
}

async function writeManagerSnapshot<T>(
  manager: ManagerAtomicJsonConfig,
  path: string,
  expectedRevision: number,
  value: T,
  options: AtomicJsonMutationOptions
): Promise<boolean> {
  const response = await fetch(`${manager.baseUrl}/v1/data/atomic-json/write`, {
    method: 'PUT',
    headers: managerHeaders(manager.token),
    body: JSON.stringify({
      path,
      expectedRevision,
      value,
      ...(options.fence ? { fence: options.fence } : {}),
      ...(options.commitId ? { commitId: options.commitId } : {})
    }),
    signal: requestSignal(options.signal)
  })
  if (response.status === 409) return classifyConflict(response, path)
  if (!response.ok) throw await managerRequestError(response, path)
  ManagerAtomicJsonSnapshotSchema.parse(await response.json())
  return true
}

async function deleteManagerSnapshot(
  manager: ManagerAtomicJsonConfig,
  path: string,
  expectedRevision: number,
  options: AtomicJsonMutationOptions
): Promise<boolean> {
  const response = await fetch(`${manager.baseUrl}/v1/data/atomic-json/delete`, {
    method: 'DELETE',
    headers: managerHeaders(manager.token),
    body: JSON.stringify({
      path,
      expectedRevision,
      ...(options.fence ? { fence: options.fence } : {}),
      ...(options.commitId ? { commitId: options.commitId } : {})
    }),
    signal: requestSignal(options.signal)
  })
  if (response.status === 409) return classifyConflict(response, path)
  if (!response.ok) throw await managerRequestError(response, path)
  ManagerAtomicJsonSnapshotSchema.parse(await response.json())
  return true
}

async function classifyConflict(response: Response, path: string): Promise<false> {
  const body = await response.clone().json().catch(() => null) as { code?: unknown } | null
  if (body?.code === 'revision_conflict') return false
  throw await managerRequestError(response, path)
}

function mutationOptions(options: AtomicJsonMutationOptions): AtomicJsonMutationOptions {
  const context = currentManagerDataMutexContext()
  return {
    signal: options.signal ?? context?.signal,
    fence: options.fence ?? context?.fence,
    commitId: options.commitId ?? currentManagerDataCommitId()
  }
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000)
}

function managerHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  }
}

async function managerRequestError(response: Response, path: string): Promise<Error> {
  const detail = await response.text().catch(() => '')
  return extensionError('EXTENSION_JSON_MANAGER_UNAVAILABLE', 'Kun Service Manager rejected shared JSON access', {
    path,
    status: response.status,
    detail: detail.slice(0, 512)
  })
}

function managerConflictError(path: string): Error {
  return extensionError(
    'EXTENSION_JSON_REVISION_CONFLICT',
    'Shared extension JSON kept changing during update',
    { path, attempts: MAX_MANAGER_WRITE_ATTEMPTS }
  )
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
