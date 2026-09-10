import { setTimeout as delayRequestRetry } from 'node:timers/promises'
import { randomBytes, randomUUID } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { z } from 'zod'
import {
  RuntimeFlavorSchema,
  RuntimeRegistrationSchema,
  ThreadExecutionLeaseSchema,
  type RuntimeFlavor,
  type RuntimeRegistration,
  type ThreadExecutionLease
} from '../contracts/runtime-flavor.js'
import {
  ThreadExecutionBusyError,
  type ThreadExecutionLeasePort
} from '../ports/thread-execution-lease.js'
import { isLoopbackHost } from '../server/loopback-host.js'
import {
  readRuntimeDiscovery,
  removeRuntimeDiscovery,
  type RuntimeDiscoveryRecord
} from '../server/runtime-discovery.js'
import {
  KUN_MANAGER_PROTOCOL_VERSION,
  defaultKunControlDir,
  defaultProductionSettingsPath,
  readManagerDiscovery,
  removeManagerDiscovery,
  withManagerStartLock,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import { sameCanonicalPath } from './canonical-path.js'
import { KUN_MANAGER_CAPABILITIES } from './service-manager.js'
import { withRuntimeDataDirAncillaryWriter } from '../server/runtime-data-dir-lease.js'

import { ServiceManagerHttpError, ServiceManagerTransportError } from './usage-errors.js'
import type { ServiceManagerConnection } from './manager-client.js'

export type ManagerRequestOptions = {
  method?: string
  body?: unknown
  fetch?: typeof fetch
  timeoutMs?: number
  signal?: AbortSignal
  /** Explicitly read-only RPCs may retry after an ambiguous socket failure. */
  retrySafe?: boolean
}

export async function requestManagerJson(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions
): Promise<unknown> {
  return performManagerRequest(manager, path, options, requireManagerJson)
}

export async function requestManagerResponse(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions
): Promise<Response> {
  return performManagerRequest(manager, path, options, async (response) => response)
}

async function performManagerRequest<T>(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions,
  consume: (response: Response) => Promise<T>
): Promise<T> {
  const fetchImpl = options.fetch ?? fetch
  const method = (options.method ?? 'GET').toUpperCase()
  const retrySafe = options.retrySafe === true || method === 'GET' || method === 'HEAD'
  // All attempts share the original budget. A cancelled request never retries.
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 5_000)])
    : AbortSignal.timeout(options.timeoutMs ?? 5_000)
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  for (let attempt = 0; ; attempt += 1) {
    signal.throwIfAborted()
    let receivedResponse = false
    try {
      const response = await fetchImpl(`${manager.discovery.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${manager.discovery.managerToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        ...(body === undefined ? {} : { body }),
        signal
      })
      receivedResponse = true
      return await consume(response)
    } catch (error) {
      const failure = classifyManagerTransportError(error)
      if (signal.aborted || attempt >= 2 || !(failure instanceof ServiceManagerTransportError) ||
        (!retrySafe && (receivedResponse || failure.kind !== 'connection_refused'))) throw failure
      // Stay on the authenticated Manager instance. A new Manager requires
      // ownership/lease recovery, never a blind data-plane endpoint swap.
      await delayRequestRetry(100 * (attempt + 1), undefined, { signal })
    }
  }
}

export async function requireManagerJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body.slice(0, 1_024)
    throw new ServiceManagerHttpError(
      response.status,
      managerErrorCode(body),
      `Kun Service Manager request failed with HTTP ${response.status}: ${detail}`,
      detail
    )
  }
  return response.json()
}

function managerErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { code?: unknown }
    return typeof parsed.code === 'string' && parsed.code ? parsed.code : undefined
  } catch {
    return undefined
  }
}

function classifyManagerTransportError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(String(error))
  const causeCode = (error.cause as NodeJS.ErrnoException | undefined)?.code
  const code = String((error as NodeJS.ErrnoException).code ?? causeCode ?? '')
  if (code === 'ECONNREFUSED') {
    return managerTransportError('connection_refused', code, error)
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError' || code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return managerTransportError('timeout', code, error)
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return managerTransportError('socket_closed', code, error)
  }
  return error
}

function managerTransportError(
  kind: import('./usage-errors.js').ServiceManagerTransportKind,
  code: string,
  cause: Error
): ServiceManagerTransportError {
  return new ServiceManagerTransportError(kind,
    `Kun Service Manager connection failed (${kind}${code ? `; ${code}` : ''}).`, { cause })
}

export function safeManagerUrl(record: ManagerDiscoveryRecord): boolean {
  try {
    const url = new URL(record.baseUrl)
    return url.protocol === 'http:' &&
      isLoopbackHost(url.hostname) &&
      isLoopbackHost(record.host) &&
      Number(url.port || '80') === record.port &&
      (url.pathname === '/' || url.pathname === '') &&
      url.username === '' &&
      url.password === ''
  } catch {
    return false
  }
}

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return String((error as { code?: unknown })?.code ?? '') === 'EPERM'
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function defaultManagerControlDirForTests(home = homedir()): string {
  return defaultKunControlDir(home)
}
