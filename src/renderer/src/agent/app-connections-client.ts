import {
  KUN_APP_CATALOG_TEMPLATE,
  KUN_APP_CONNECTION_ATTEMPT_TEMPLATE,
  KUN_APP_CONNECTION_CHECK_TEMPLATE,
  KUN_APP_CONNECTION_CONNECT_TEMPLATE,
  KUN_APP_CONNECTION_CREDENTIAL_TEMPLATE,
  KUN_APP_CONNECTION_TEMPLATE,
  KUN_APP_CONNECTIONS_TEMPLATE
} from '@shared/kun-endpoints'
import { rendererRuntimeClient } from './runtime-client'

export type AppPresetView = {
  id: string
  appId: string
  name: string
  kind: 'mcp_oauth' | 'mcp_local' | 'native_github' | 'native_gmail' | 'native_figma'
  availability: 'ready' | 'planned' | 'vendor_approval'
  platforms: string[]
  docsUrl: string
}

export type AppConnectionView = {
  presetId: string
  appId: string
  name: string
  kind: AppPresetView['kind']
  availability: AppPresetView['availability']
  platformSupported: boolean
  installed: boolean
  accountStatus: 'connected' | 'disconnected' | 'pending' | 'error' | 'unavailable'
  transportStatus: 'ready' | 'unreachable' | 'unknown' | 'not_applicable'
  accountLabel?: string
  workspaceLabel?: string
  toolCount: number
  errorCode?: string
  errorMessage?: string
  nextAction?: string
  revision: number
}

export type AppConnectionAttempt = { presetId: string; attemptId: string; url?: string }

export class AppConnectionsClientError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'AppConnectionsClientError'
  }
}

async function request<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<T> {
  const response = await rendererRuntimeClient.runtimeRequest(
    path,
    method,
    body === undefined ? undefined : JSON.stringify(body)
  )
  const parsed = typeof response.body === 'string' ? safeParse(response.body) : response.body
  if (!response.ok) {
    const failure = parsed as { code?: string; message?: string } | undefined
    throw new AppConnectionsClientError(
      failure?.code ?? 'runtime_error',
      failure?.message ?? 'Kun could not complete that connection request',
      response.status
    )
  }
  return parsed as T
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const presetPath = (presetId: string): string =>
  KUN_APP_CONNECTION_TEMPLATE.replace('{id}', encodeURIComponent(presetId))

export async function fetchAppCatalog(): Promise<AppPresetView[]> {
  const body = await request<{ presets: AppPresetView[] }>(KUN_APP_CATALOG_TEMPLATE, 'GET')
  return body.presets
}

export async function fetchAppConnections(): Promise<AppConnectionView[]> {
  const body = await request<{ connections: AppConnectionView[] }>(KUN_APP_CONNECTIONS_TEMPLATE, 'GET')
  return body.connections
}

export async function connectApp(presetId: string): Promise<AppConnectionAttempt> {
  const path = KUN_APP_CONNECTION_CONNECT_TEMPLATE.replace('{id}', encodeURIComponent(presetId))
  const body = await request<{ attempt: AppConnectionAttempt }>(path, 'POST')
  return body.attempt
}

export async function pollAppAttempt(presetId: string, attemptId: string): Promise<unknown> {
  const path = KUN_APP_CONNECTION_ATTEMPT_TEMPLATE
    .replace('{id}', encodeURIComponent(presetId))
    .replace('{attemptId}', encodeURIComponent(attemptId))
  const body = await request<{ attempt: unknown }>(path, 'GET')
  return body.attempt
}

export async function checkApp(presetId: string): Promise<AppConnectionView> {
  const path = KUN_APP_CONNECTION_CHECK_TEMPLATE.replace('{id}', encodeURIComponent(presetId))
  const body = await request<{ connection: AppConnectionView }>(path, 'POST')
  return body.connection
}

export async function saveAppCredential(
  presetId: string,
  token: string,
  expiresAt?: string
): Promise<AppConnectionView> {
  const path = KUN_APP_CONNECTION_CREDENTIAL_TEMPLATE.replace('{id}', encodeURIComponent(presetId))
  const body = await request<{ connection: AppConnectionView }>(path, 'PUT', {
    token,
    ...(expiresAt ? { expiresAt } : {})
  })
  return body.connection
}

export async function disconnectApp(presetId: string): Promise<AppConnectionView> {
  const body = await request<{ connection: AppConnectionView }>(presetPath(presetId), 'DELETE')
  return body.connection
}
