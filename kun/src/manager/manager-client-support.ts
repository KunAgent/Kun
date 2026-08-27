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
  return fetchImpl(`${manager.discovery.baseUrl}${path}`, {
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
}

export async function requireManagerJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Kun Service Manager request failed with HTTP ${response.status}: ${body.slice(0, 1_024)}`)
  }
  return response.json()
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
