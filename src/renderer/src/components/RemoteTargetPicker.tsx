import { useEffect, useState, type ReactElement } from 'react'
import type {
  RemoteConnectionTestResult,
  RemoteHostsResult,
  RemoteRunMode,
  RemoteTargetInput
} from '../agent/remote-target'

const RUN_MODE_OPTIONS: Array<{ value: RemoteRunMode; label: string }> = [
  { value: 'observe', label: 'Observe · 只读' },
  { value: 'develop', label: 'Develop · 开发' },
  { value: 'operations', label: 'Operations · 运维' },
  { value: 'deploy', label: 'Deploy · 部署' }
]

const fieldClass =
  'rounded-lg border border-ds-border-muted bg-ds-card px-2.5 py-1.5 text-xs text-ds-primary outline-none transition focus:border-ds-accent focus:ring-2 focus:ring-ds-accent/20 disabled:opacity-60'
const labelClass = 'text-[11px] font-medium uppercase tracking-[0.12em] text-ds-muted'

export type RemoteTargetPickerProps = {
  value: RemoteTargetInput | null
  onChange: (value: RemoteTargetInput | null) => void
  listHosts: () => Promise<RemoteHostsResult>
  testConnection: (input: { alias: string; remoteDir?: string }) => Promise<RemoteConnectionTestResult>
  disabled?: boolean
}

export function RemoteTargetPicker({
  value,
  onChange,
  listHosts,
  testConnection,
  disabled = false
}: RemoteTargetPickerProps): ReactElement {
  const isRemote = value !== null
  const [hosts, setHosts] = useState<RemoteHostsResult | null>(null)
  const [loadingHosts, setLoadingHosts] = useState(false)
  const [hostsError, setHostsError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<RemoteConnectionTestResult | null>(null)

  useEffect(() => {
    if (!isRemote || hosts || loadingHosts) return
    let cancelled = false
    setLoadingHosts(true)
    setHostsError(null)
    listHosts()
      .then((result) => {
        if (!cancelled) setHosts(result)
      })
      .catch((error: unknown) => {
        if (!cancelled) setHostsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingHosts(false)
      })
    return () => {
      cancelled = true
    }
  }, [hosts, isRemote, listHosts, loadingHosts])

  const patchValue = (patch: Partial<RemoteTargetInput>): void => {
    onChange({ alias: '', runMode: 'observe', production: false, protectedPaths: [], ...value, ...patch })
    setTestResult(null)
  }

  const setRemoteEnabled = (enabled: boolean): void => {
    setTestResult(null)
    if (!enabled) {
      onChange(null)
      return
    }
    onChange({ alias: '', runMode: 'observe', production: false, protectedPaths: [] })
  }

  const runTest = async (): Promise<void> => {
    const alias = value?.alias.trim() ?? ''
    if (!alias) return
    setTesting(true)
    setTestResult(null)
    try {
      setTestResult(await testConnection({
        alias,
        ...(value?.remoteDir?.trim() ? { remoteDir: value.remoteDir.trim() } : {})
      }))
    } catch (error) {
      setTestResult({
        ok: false,
        alias,
        status: 'error',
        tools: {},
        error: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="w-full rounded-2xl border border-ds-border-muted bg-ds-card/80 p-3 text-xs shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className={labelClass}>Run location / 运行位置</span>
        <label className="inline-flex items-center gap-1.5 text-ds-secondary">
          <input
            type="radio"
            checked={!isRemote}
            disabled={disabled}
            onChange={() => setRemoteEnabled(false)}
          />
          <span>Local</span>
        </label>
        <label className="inline-flex items-center gap-1.5 text-ds-secondary">
          <input
            type="radio"
            checked={isRemote}
            disabled={disabled}
            onChange={() => setRemoteEnabled(true)}
          />
          <span>SSH Remote</span>
        </label>
        {isRemote ? (
          <span className="text-[11px] text-ds-muted">Applies to the next new thread.</span>
        ) : null}
      </div>

      {isRemote ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClass}>Host alias</span>
            <select
              className={fieldClass}
              value={value.alias}
              disabled={disabled || loadingHosts}
              onChange={(event) => patchValue({ alias: event.target.value })}
            >
              <option value="">{loadingHosts ? 'Loading hosts…' : 'Select SSH host'}</option>
              {hosts?.hosts.map((host) => (
                <option key={host.alias} value={host.alias}>
                  {host.hostName ? `${host.alias} · ${host.hostName}` : host.alias}
                </option>
              ))}
            </select>
            {hosts && !hosts.configFound ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-300">
                No readable ~/.ssh/config was found.
              </span>
            ) : null}
            {hostsError ? <span className="text-[11px] text-red-500">{hostsError}</span> : null}
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClass}>Remote dir</span>
            <input
              className={fieldClass}
              value={value.remoteDir ?? ''}
              disabled={disabled}
              placeholder="/srv/app"
              onChange={(event) => patchValue({ remoteDir: event.target.value })}
            />
          </label>

          <label className="flex min-w-0 flex-col gap-1">
            <span className={labelClass}>Run mode</span>
            <select
              className={fieldClass}
              value={value.runMode ?? 'observe'}
              disabled={disabled}
              onChange={(event) => patchValue({ runMode: event.target.value as RemoteRunMode })}
            >
              {RUN_MODE_OPTIONS.map((mode) => (
                <option key={mode.value} value={mode.value}>{mode.label}</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 self-end text-ds-secondary">
            <input
              type="checkbox"
              checked={value.production ?? false}
              disabled={disabled}
              onChange={(event) => patchValue({ production: event.target.checked })}
            />
            <span>Production target</span>
          </label>

          <label className="flex min-w-0 flex-col gap-1 md:col-span-2">
            <span className={labelClass}>Protected paths</span>
            <textarea
              className={`${fieldClass} min-h-16 resize-y`}
              value={(value.protectedPaths ?? []).join('\n')}
              disabled={disabled}
              placeholder={'.env\n/etc\n/var/lib'}
              onChange={(event) => patchValue({
                protectedPaths: event.target.value
                  .split(/\r?\n/)
                  .map((entry) => entry.trim())
                  .filter(Boolean)
              })}
            />
          </label>

          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <button
              type="button"
              className="rounded-lg border border-ds-border-muted px-3 py-1.5 text-xs font-medium text-ds-secondary transition hover:border-ds-accent hover:text-ds-primary disabled:opacity-50"
              disabled={disabled || testing || !value.alias.trim()}
              onClick={() => void runTest()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testResult ? <ConnectionTestResult result={testResult} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

function ConnectionTestResult({ result }: { result: RemoteConnectionTestResult }): ReactElement {
  if (!result.ok) {
    return (
      <span className="text-xs text-red-500">
        {result.error || result.status || 'Connection test failed'}
      </span>
    )
  }

  const toolEntries = Object.entries(result.tools ?? {})
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ds-muted">
      <span className="font-medium text-emerald-600 dark:text-emerald-300">status: {result.status}</span>
      {result.latencyMs != null ? <span>latency: {Math.round(result.latencyMs)}ms</span> : null}
      {result.os ? <span>OS: {result.os}</span> : null}
      {result.branch ? <span>branch: {result.branch}</span> : null}
      {result.dirty != null ? <span>dirty: {result.dirty ? 'yes' : 'no'}</span> : null}
      {result.repoRoot ? <span className="max-w-full truncate">repoRoot: {result.repoRoot}</span> : null}
      {toolEntries.length ? (
        <span>
          tools: {toolEntries.map(([name, ok]) => `${name}:${ok ? 'ok' : 'missing'}`).join(', ')}
        </span>
      ) : null}
    </div>
  )
}
