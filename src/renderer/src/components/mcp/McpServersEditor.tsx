import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Code2, Plus, Trash2 } from 'lucide-react'
import {
  createBlankMcpServer,
  isMcpTransport,
  parseMcpConfigText,
  serializeMcpConfig,
  validateMcpServers,
  type McpFormModel,
  type McpFormServer,
  type McpKeyValue,
  type McpServerFieldError,
  type McpTransport
} from './mcp-config-form'

type Props = {
  value: string
  onChange: (text: string) => void
  disabled?: boolean
  /** Switch to the raw JSON textarea (advanced escape hatch). */
  rawMode: boolean
  onToggleRawMode: (raw: boolean) => void
  loadingPlaceholder?: string
}

const inputClass =
  'w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const inputErrorClass =
  'w-full min-w-0 rounded-xl border border-red-400 bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:outline-none focus:ring-1 focus:ring-red-300'
const selectClass =
  'rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30'
const labelClass = 'flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ds-muted'
const ghostButtonClass =
  'inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55'

const EMPTY_MODEL: McpFormModel = { servers: [], preserved: {} }

export function McpServersEditor({
  value,
  onChange,
  disabled = false,
  rawMode,
  onToggleRawMode,
  loadingPlaceholder
}: Props): ReactElement {
  const { t } = useTranslation('settings')

  // The editor holds its own working model so in-progress edits (a blank env
  // row, a half-typed arg line) survive — serialization drops those, so we
  // must NOT re-derive the model from the serialized text on every keystroke.
  // We re-sync from `value` only when it changes for a reason *other* than our
  // own emit (external load / reload / raw-mode edits).
  const [model, setModel] = useState<McpFormModel>(() => {
    const parsed = parseMcpConfigText(value)
    return parsed.ok ? parsed.model : EMPTY_MODEL
  })
  const lastEmittedRef = useRef<string | null>(null)

  useEffect(() => {
    if (value === lastEmittedRef.current) return
    const parsed = parseMcpConfigText(value)
    if (parsed.ok) setModel(parsed.model)
  }, [value])

  const errorMessages = useMemo(
    () => ({
      nameRequired: t('mcpFormErrorNameRequired'),
      nameDuplicate: t('mcpFormErrorNameDuplicate'),
      commandRequired: t('mcpFormErrorCommandRequired'),
      urlRequired: t('mcpFormErrorUrlRequired'),
      urlInvalid: t('mcpFormErrorUrlInvalid'),
      workspaceRootsRequired: t('mcpFormErrorWorkspaceRoots')
    }),
    [t]
  )

  // If the current text can't be parsed, force the raw editor so the user can
  // repair it by hand rather than silently losing content.
  const parseError = useMemo(() => {
    const parsed = parseMcpConfigText(value)
    return parsed.ok ? null : parsed.error
  }, [value])
  const forceRaw = parseError !== null
  const showRaw = rawMode || forceRaw

  const fieldErrors = useMemo(
    () => validateMcpServers(model.servers, errorMessages),
    [model.servers, errorMessages]
  )
  const errorsByRow = useMemo(() => {
    const map = new Map<string, McpServerFieldError[]>()
    for (const error of fieldErrors) {
      const list = map.get(error.rowId) ?? []
      list.push(error)
      map.set(error.rowId, list)
    }
    return map
  }, [fieldErrors])

  const apply = (servers: McpFormServer[]): void => {
    const next: McpFormModel = { servers, preserved: model.preserved }
    setModel(next)
    const text = serializeMcpConfig(next)
    lastEmittedRef.current = text
    onChange(text)
  }

  const updateServer = (rowId: string, patch: Partial<McpFormServer>): void => {
    apply(model.servers.map((server) => (server.rowId === rowId ? { ...server, ...patch } : server)))
  }
  const removeServer = (rowId: string): void => {
    apply(model.servers.filter((server) => server.rowId !== rowId))
  }
  const addServer = (): void => {
    apply([...model.servers, createBlankMcpServer('stdio')])
  }

  const fieldError = (rowId: string, field: McpServerFieldError['field']): string | null =>
    errorsByRow.get(rowId)?.find((error) => error.field === field)?.message ?? null

  if (showRaw) {
    return (
      <div className="flex w-full flex-col gap-3">
        {forceRaw ? (
          <div className="rounded-xl border border-red-400/40 bg-red-500/10 px-3 py-2 text-[12px] leading-5 text-red-700 dark:text-red-200">
            {t('mcpFormInvalidJson', { error: parseError ?? '' })}
          </div>
        ) : null}
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          disabled={disabled}
          placeholder={loadingPlaceholder}
          className="min-h-[320px] w-full rounded-2xl border border-ds-border bg-ds-card px-4 py-3 font-mono text-[13px] leading-6 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        {!forceRaw ? (
          <div>
            <button type="button" onClick={() => onToggleRawMode(false)} className={ghostButtonClass}>
              {t('mcpFormBackToForm')}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-3">
      {model.servers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ds-border bg-ds-main/40 px-4 py-6 text-center text-[13px] text-ds-faint">
          {t('mcpFormEmpty')}
        </div>
      ) : (
        model.servers.map((server) => (
          <McpServerCard
            key={server.rowId}
            server={server}
            disabled={disabled}
            onChange={(patch) => updateServer(server.rowId, patch)}
            onRemove={() => removeServer(server.rowId)}
            fieldError={(field) => fieldError(server.rowId, field)}
          />
        ))
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={addServer} disabled={disabled} className={ghostButtonClass}>
          <Plus className="h-4 w-4" strokeWidth={1.9} />
          {t('mcpFormAddServer')}
        </button>
        <button type="button" onClick={() => onToggleRawMode(true)} disabled={disabled} className={ghostButtonClass}>
          <Code2 className="h-4 w-4" strokeWidth={1.9} />
          {t('mcpFormEditJson')}
        </button>
      </div>
    </div>
  )
}

function McpServerCard({
  server,
  disabled,
  onChange,
  onRemove,
  fieldError
}: {
  server: McpFormServer
  disabled: boolean
  onChange: (patch: Partial<McpFormServer>) => void
  onRemove: () => void
  fieldError: (field: McpServerFieldError['field']) => string | null
}): ReactElement {
  const { t } = useTranslation('settings')
  const isStdio = server.transport === 'stdio'
  const nameError = fieldError('name')
  const commandError = fieldError('command')
  const urlError = fieldError('url')
  const rootsError = fieldError('trustedWorkspaceRoots')

  return (
    <div
      className={`rounded-2xl border px-4 py-3 shadow-sm ${
        server.enabled ? 'border-ds-border bg-ds-card' : 'border-ds-border-muted bg-ds-main/40'
      }`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${labelClass} flex-1`}>
          {t('mcpFormName')}
          <input
            value={server.name}
            disabled={disabled}
            placeholder={t('mcpFormNamePlaceholder')}
            onChange={(e) => onChange({ name: e.target.value })}
            className={nameError ? inputErrorClass : inputClass}
          />
        </label>
        <label className={labelClass}>
          {t('mcpFormTransport')}
          <select
            value={server.transport}
            disabled={disabled}
            onChange={(e) => {
              const next = e.target.value
              if (isMcpTransport(next)) onChange({ transport: next as McpTransport })
            }}
            className={selectClass}
          >
            <option value="stdio">{t('mcpFormTransportStdio')}</option>
            <option value="streamable-http">{t('mcpFormTransportHttp')}</option>
            <option value="sse">{t('mcpFormTransportSse')}</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[12px] font-medium text-ds-muted">
          <input
            type="checkbox"
            checked={server.enabled}
            disabled={disabled}
            onChange={(e) => onChange({ enabled: e.target.checked })}
            className="h-4 w-4 rounded border-ds-border accent-accent"
          />
          {t('mcpFormEnabled')}
        </label>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('mcpFormRemoveServer')}
          title={t('mcpFormRemoveServer')}
          className="mb-1 rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-55 dark:hover:text-red-300"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      {nameError ? <FieldError message={nameError} /> : null}

      <div className="mt-3 flex flex-col gap-3">
        {isStdio ? (
          <>
            <label className={labelClass}>
              {t('mcpFormCommand')}
              <input
                value={server.command}
                disabled={disabled}
                placeholder="npx"
                onChange={(e) => onChange({ command: e.target.value })}
                className={commandError ? inputErrorClass : inputClass}
              />
              {commandError ? <FieldError message={commandError} /> : null}
            </label>
            <label className={labelClass}>
              {t('mcpFormCwd')}
              <input
                value={server.cwd}
                disabled={disabled}
                placeholder={t('mcpFormCwdPlaceholder')}
                onChange={(e) => onChange({ cwd: e.target.value })}
                className={inputClass}
              />
              <span className="text-[11px] font-normal text-ds-faint">{t('mcpFormCwdHint')}</span>
            </label>
            <label className={labelClass}>
              {t('mcpFormArgs')}
              <textarea
                value={server.args.join('\n')}
                disabled={disabled}
                placeholder={t('mcpFormArgsPlaceholder')}
                onChange={(e) => onChange({ args: e.target.value.split('\n') })}
                className="min-h-[72px] w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] leading-5 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
            </label>
            <KeyValueEditor
              label={t('mcpFormEnv')}
              addLabel={t('mcpFormAddEnv')}
              keyPlaceholder={t('mcpFormEnvKey')}
              valuePlaceholder={t('mcpFormEnvValue')}
              entries={server.env}
              disabled={disabled}
              onChange={(env) => onChange({ env })}
            />
          </>
        ) : (
          <>
            <label className={labelClass}>
              {t('mcpFormUrl')}
              <input
                value={server.url}
                disabled={disabled}
                placeholder="https://example.com/mcp"
                onChange={(e) => onChange({ url: e.target.value })}
                className={urlError ? inputErrorClass : inputClass}
              />
              {urlError ? <FieldError message={urlError} /> : null}
            </label>
            <KeyValueEditor
              label={t('mcpFormHeaders')}
              addLabel={t('mcpFormAddHeader')}
              keyPlaceholder={t('mcpFormHeaderKey')}
              valuePlaceholder={t('mcpFormHeaderValue')}
              entries={server.headers}
              disabled={disabled}
              onChange={(headers) => onChange({ headers })}
            />
          </>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            {t('mcpFormTrustScope')}
            <select
              value={server.trustScope}
              disabled={disabled}
              onChange={(e) =>
                onChange({ trustScope: e.target.value === 'workspace' ? 'workspace' : 'user' })
              }
              className={selectClass}
            >
              <option value="user">{t('mcpFormTrustScopeUser')}</option>
              <option value="workspace">{t('mcpFormTrustScopeWorkspace')}</option>
            </select>
          </label>
          <label className={labelClass}>
            {t('mcpFormTimeout')}
            <input
              type="number"
              min={1}
              value={server.timeoutMs ?? ''}
              disabled={disabled}
              placeholder="30000"
              onChange={(e) => {
                const next = Number(e.target.value)
                onChange({ timeoutMs: Number.isFinite(next) && next > 0 ? Math.floor(next) : null })
              }}
              className={inputClass}
            />
          </label>
        </div>

        <label className={labelClass}>
          {t('mcpFormVisibleRoots')}
          <textarea
            value={server.workspaceRoots.join('\n')}
            disabled={disabled}
            placeholder={t('mcpFormVisibleRootsPlaceholder')}
            onChange={(e) => onChange({ workspaceRoots: e.target.value.split('\n') })}
            className="min-h-[60px] w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12.5px] leading-5 text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <span className="text-[11px] font-normal text-ds-faint">{t('mcpFormVisibleRootsHint')}</span>
        </label>

        {server.trustScope === 'workspace' ? (
          <label className={labelClass}>
            {t('mcpFormTrustedRoots')}
            <textarea
              value={server.trustedWorkspaceRoots.join('\n')}
              disabled={disabled}
              placeholder={t('mcpFormTrustedRootsPlaceholder')}
              onChange={(e) => onChange({ trustedWorkspaceRoots: e.target.value.split('\n') })}
              className={`min-h-[60px] font-mono text-[12.5px] leading-5 ${rootsError ? inputErrorClass : inputClass}`}
            />
            {rootsError ? <FieldError message={rootsError} /> : null}
          </label>
        ) : null}
      </div>
    </div>
  )
}

function KeyValueEditor({
  label,
  addLabel,
  keyPlaceholder,
  valuePlaceholder,
  entries,
  disabled,
  onChange
}: {
  label: string
  addLabel: string
  keyPlaceholder: string
  valuePlaceholder: string
  entries: McpKeyValue[]
  disabled: boolean
  onChange: (entries: McpKeyValue[]) => void
}): ReactElement {
  const updateEntry = (index: number, patch: Partial<McpKeyValue>): void => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
  }
  const removeEntry = (index: number): void => {
    onChange(entries.filter((_, i) => i !== index))
  }
  const addEntry = (): void => {
    onChange([...entries, { key: '', value: '' }])
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-medium text-ds-muted">{label}</span>
      {entries.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            value={entry.key}
            disabled={disabled}
            placeholder={keyPlaceholder}
            onChange={(e) => updateEntry(index, { key: e.target.value })}
            className={`${inputClass} flex-1`}
          />
          <input
            value={entry.value}
            disabled={disabled}
            placeholder={valuePlaceholder}
            onChange={(e) => updateEntry(index, { value: e.target.value })}
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={() => removeEntry(index)}
            disabled={disabled}
            className="shrink-0 rounded-lg p-1.5 text-ds-muted transition hover:bg-red-500/10 hover:text-red-600 disabled:opacity-55 dark:hover:text-red-300"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" onClick={addEntry} disabled={disabled} className={ghostButtonClass}>
          <Plus className="h-3.5 w-3.5" strokeWidth={1.9} />
          {addLabel}
        </button>
      </div>
    </div>
  )
}

function FieldError({ message }: { message: string }): ReactElement {
  return <p className="mt-1 text-[12px] text-red-700 dark:text-red-300">{message}</p>
}
