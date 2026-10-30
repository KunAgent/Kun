import { Loader2, PlugZap, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { settingsButtonClass } from './settings-button'
import {
  AppConnectionsClientError,
  checkApp,
  connectApp,
  disconnectApp,
  fetchAppConnections,
  saveAppCredential,
  type AppConnectionView
} from '../agent/app-connections-client'

type Notice = { tone: 'error' | 'success' | 'info'; text: string }

const STATUS_LABEL: Record<AppConnectionView['accountStatus'], string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  pending: 'Waiting for authorization',
  error: 'Needs attention',
  unavailable: 'Not available in this build'
}

const AVAILABILITY_LABEL: Record<AppConnectionView['availability'], string> = {
  ready: 'Available',
  planned: 'Coming soon',
  vendor_approval: 'Waiting for vendor approval'
}

function message(error: unknown): string {
  if (error instanceof AppConnectionsClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return 'Kun could not reach its runtime. Try again.'
}

/**
 * Account-level app connections. This page never grants a conversation access:
 * connecting here makes tools ready, and each conversation still needs its own
 * consent where the app requires one.
 */
export function ConnectionsSettingsSection({ ctx }: { ctx?: Record<string, any> }): ReactElement {
  void ctx
  const [connections, setConnections] = useState<AppConnectionView[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [token, setToken] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setConnections(await fetchAppConnections())
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', text: message(error) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(async (presetId: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(presetId)
    try {
      const result = await work()
      if (isConnectionView(result)) {
        const next = result
        setConnections((current) => current.map((entry) => (entry.presetId === next.presetId ? next : entry)))
      } else {
        // A connect attempt is not a connection view: re-read the aggregated state.
        await load()
      }
      setNotice(done ? { tone: 'success', text: done } : null)
    } catch (error) {
      setNotice({ tone: 'error', text: message(error) })
    } finally {
      setBusy(null)
    }
  }, [load])

  const apps = groupByApp(connections)

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-[15px] font-semibold text-ds-ink">Connections</h2>
        <p className="text-[12px] leading-relaxed text-ds-muted">
          Connect your accounts once. Credentials stay in Kun&apos;s encrypted local store and are never
          shown in chat, logs, or model context.
        </p>
      </header>

      {notice ? (
        <div
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={
            notice.tone === 'error'
              ? 'rounded-lg border border-red-300/80 bg-red-50 px-3 py-2 text-[12px] text-red-800 dark:border-red-800/70 dark:bg-red-950/25 dark:text-red-200'
              : 'rounded-lg border border-ds-border bg-ds-main/50 px-3 py-2 text-[12px] text-ds-muted'
          }
        >
          {notice.text}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-ds-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading connections…
        </div>
      ) : null}

      <div className="space-y-3">
        {apps.map((group) => (
          <section key={group.appId} className="rounded-xl border border-ds-border bg-ds-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-semibold text-ds-ink">{group.name}</h3>
              <span className="text-[11px] text-ds-muted">
                {group.primary ? STATUS_LABEL[group.primary.accountStatus] : 'Not connected'}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              {group.connections.map((connection) => (
                <div
                  key={connection.presetId}
                  className="rounded-lg border border-ds-border/70 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-ds-ink">{connection.name}</div>
                      <div className="text-[11px] text-ds-muted">
                        {STATUS_LABEL[connection.accountStatus]}
                        {connection.accountLabel ? ` · ${connection.accountLabel}` : ''}
                        {connection.toolCount > 0 ? ` · ${connection.toolCount} tools` : ''}
                        {` · ${AVAILABILITY_LABEL[connection.availability]}`}
                      </div>
                      {connection.errorMessage ? (
                        <div className="mt-1 text-[11px] text-red-700 dark:text-red-300">
                          {connection.errorMessage}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className={settingsButtonClass({ variant: 'secondary', className: 'h-7 px-2 text-[11px]' })}
                        disabled={busy !== null || !connection.platformSupported}
                        onClick={() => void run(connection.presetId, () => checkApp(connection.presetId))}
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />
                        Check
                      </button>

                      {connection.availability === 'ready' && connection.kind === 'native_github' ? (
                        <button
                          type="button"
                          className={settingsButtonClass({ variant: 'primary', className: 'h-7 px-2 text-[11px]' })}
                          disabled={busy !== null || !connection.platformSupported}
                          onClick={() => void run(
                            connection.presetId,
                            () => connectApp(connection.presetId),
                            'Finish the GitHub login in your browser.'
                          )}
                        >
                          <PlugZap className="h-3 w-3" aria-hidden="true" />
                          {connection.accountStatus === 'connected' ? 'Reconnect' : 'Connect'}
                        </button>
                      ) : null}

                      {connection.kind === 'native_figma' ? (
                        <button
                          type="button"
                          className={settingsButtonClass({ variant: 'secondary', className: 'h-7 px-2 text-[11px]' })}
                          disabled={busy !== null || !connection.installed}
                          onClick={() => void run(
                            connection.presetId,
                            () => disconnectApp(connection.presetId),
                            'Figma is disconnected on this device.'
                          )}
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          Disconnect
                        </button>
                      ) : null}

                      {connection.kind === 'native_gmail' ? (
                        <span className="text-[11px] text-ds-muted">
                          Connect from a conversation
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {connection.kind === 'native_figma' ? (
                    <form
                      className="mt-2 flex flex-wrap items-center gap-1.5"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const value = token.trim()
                        if (!value) return
                        void run(
                          connection.presetId,
                          () => saveAppCredential(connection.presetId, value),
                          'Figma token verified and stored.'
                        ).then(() => setToken(''))
                      }}
                    >
                      <label className="sr-only" htmlFor={`figma-token-${connection.presetId}`}>
                        Figma personal access token
                      </label>
                      <input
                        id={`figma-token-${connection.presetId}`}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        placeholder="figd_… personal access token"
                        className="h-7 min-w-0 flex-1 rounded-md border border-ds-border bg-ds-main px-2 text-[12px] text-ds-ink"
                      />
                      <button
                        type="submit"
                        className={settingsButtonClass({ variant: 'primary', className: 'h-7 px-2 text-[11px]' })}
                        disabled={busy !== null || token.trim().length === 0}
                      >
                        Save token
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-ds-muted">
        A connection here does not give any conversation access on its own. Apps that require consent still
        ask for it in the conversation where their tools are used.
      </p>
    </div>
  )
}

function groupByApp(connections: AppConnectionView[]): {
  appId: string
  name: string
  primary?: AppConnectionView
  connections: AppConnectionView[]
}[] {
  const groups = new Map<string, AppConnectionView[]>()
  for (const connection of connections) {
    const list = groups.get(connection.appId) ?? []
    list.push(connection)
    groups.set(connection.appId, list)
  }
  return [...groups].map(([appId, list]) => ({
    appId,
    name: appName(list[0]),
    primary: list.find((entry) => entry.accountStatus === 'connected') ?? list[0],
    connections: list
  }))
}

function appName(connection: AppConnectionView | undefined): string {
  if (!connection) return ''
  return connection.appId === 'figma' ? 'Figma' : connection.name
}

/** A connect attempt also carries `presetId`, so the status field is the discriminator. */
function isConnectionView(value: unknown): value is AppConnectionView {
  return Boolean(value) && typeof value === 'object' && 'accountStatus' in (value as Record<string, unknown>)
}
