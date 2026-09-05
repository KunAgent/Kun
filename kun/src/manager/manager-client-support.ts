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
}

export async function requestManagerJson(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions
): Promise<unknown> {
  return requireManagerJson(await requestManagerResponse(manager, path, options))
}

export async function requestManagerResponse(
  manager: ServiceManagerConnection,
  path: string,
  options: ManagerRequestOptions
): Promise<Response> {
  const fetchImpl = options.fetch ?? fetch
  try {
    return await fetchImpl(`${manager.discovery.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        authorization: `Bearer ${manager.discovery.managerToken}`,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 5_000)])
        : AbortSignal.timeout(options.timeoutMs ?? 5_000)
    })
  } catch (error) {
    throw classifyManagerTransportError(error)
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
    return new ServiceManagerTransportError('connection_refused', error.message, { cause: error })
  }
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return new ServiceManagerTransportError('timeout', error.message, { cause: error })
  }
  if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
    return new ServiceManagerTransportError('socket_closed', error.message, { cause: error })
  }
  return error
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
