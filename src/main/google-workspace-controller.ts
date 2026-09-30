import {
  GOOGLE_WORKSPACE_RUNTIME_PATH,
  type GoogleWorkspaceAction,
  type GoogleWorkspaceStatus
} from '../shared/google-workspace'
import { googleWorkspaceStatusSchema } from './google-workspace-schema'
import type { RuntimeRequestResult } from '../shared/kun-gui-api'

export type GoogleWorkspaceHostRequest = (
  path: string,
  method: string,
  body: string | undefined,
  headers: Record<string, string>
) => Promise<RuntimeRequestResult>

export function isGoogleWorkspaceAuthorizationUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 16_384) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'accounts.google.com' &&
      !url.username && !url.password && !url.port && !url.hash &&
      ['/o/oauth2/auth', '/o/oauth2/v2/auth'].includes(url.pathname)
  } catch {
    return false
  }
}

export function createGoogleWorkspaceController(options: {
  request: GoogleWorkspaceHostRequest
  openExternal: (url: string) => Promise<unknown>
}) {
  let generation = 0
  let pending: Promise<GoogleWorkspaceStatus> | undefined
  let cancelling: Promise<GoogleWorkspaceStatus> | undefined
  let loginId: string | undefined
  let openedId: string | undefined
  let openFailureId: string | undefined

  const request = async (action: string, method = 'GET'): Promise<unknown> => {
    let response: RuntimeRequestResult
    try {
      response = await options.request(
        `${GOOGLE_WORKSPACE_RUNTIME_PATH}/${action}`, method, undefined,
        { 'X-Kun-Google-Workspace-UI': '1' }
      )
    } catch {
      throw new Error('Google Workspace could not reach the Kun runtime. Try again.')
    }
    // Never forward raw response bodies or thrown process output across IPC.
    if (!response.ok) throw new Error(`Google Workspace request failed (HTTP ${response.status}).`)
    try { return JSON.parse(response.body) } catch {
      throw new Error('Kun returned invalid Google Workspace status.')
    }
  }
  const parseStatus = (value: unknown): GoogleWorkspaceStatus => {
    const parsed = googleWorkspaceStatusSchema.safeParse(value)
    if (!parsed.success) throw new Error('Kun returned invalid Google Workspace status.')
    return parsed.data
  }
  const status = async (): Promise<GoogleWorkspaceStatus> => parseStatus(await request('status'))

  const start = (action: GoogleWorkspaceAction): Promise<GoogleWorkspaceStatus> => {
    if (pending || cancelling) return Promise.reject(new Error('A Google Workspace action is already running.'))
    const token = ++generation
    loginId = undefined
    openedId = undefined
    openFailureId = undefined
    const task = request(action, 'POST').then(parseStatus).then((result) => {
      if (token === generation && action === 'login' && result.operation?.state === 'running') {
        loginId = result.operation.id
      }
      return result
    })
    pending = task
    void task.finally(() => { if (pending === task) pending = undefined }).catch(() => undefined)
    return task
  }

  const cancel = (): Promise<GoogleWorkspaceStatus> => {
    // Revoke browser-opening authority synchronously, before any network await.
    ++generation
    loginId = undefined
    openedId = undefined
    openFailureId = undefined
    if (cancelling) return cancelling
    const startInFlight = pending
    const task = (async () => {
      // A late start response must not arrive after cancellation and start login.
      await startInFlight?.catch(() => undefined)
      return parseStatus(await request('cancel', 'POST'))
    })()
    cancelling = task
    void task.finally(() => { if (cancelling === task) cancelling = undefined }).catch(() => undefined)
    return task
  }

  const openAuthorization = async (): Promise<{ opened: boolean }> => {
    const token = generation
    const operationId = loginId
    if (operationId && openFailureId === operationId) {
      throw new Error('The Google authorization browser could not be opened. Cancel and try connecting again.')
    }
    if (!operationId || openedId === operationId || cancelling) return { opened: false }
    const raw = await request('authorization-url')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Kun returned invalid Google Workspace authorization data.')
    }
    const result = raw as { authorizationUrl?: unknown; operationId?: unknown }
    if (token !== generation || result.operationId !== operationId || !result.authorizationUrl) return { opened: false }
    if (!isGoogleWorkspaceAuthorizationUrl(result.authorizationUrl)) {
      throw new Error('Google Workspace returned an untrusted authorization URL.')
    }
    const current = await status()
    if (token !== generation || current.operation?.id !== operationId ||
      current.operation.kind !== 'login' || current.operation.state !== 'running' || openedId === operationId) {
      return { opened: false }
    }
    openedId = operationId
    try { await options.openExternal(result.authorizationUrl) } catch {
      if (token === generation) openFailureId = operationId
      throw new Error('The Google authorization browser could not be opened. Cancel and try connecting again.')
    }
    return { opened: true }
  }

  return { status, start, cancel, openAuthorization }
}
