import { useMemo, useState, type ReactElement } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CircleAlert, Eye, EyeOff, Loader2, Lock, Plus, X } from 'lucide-react'
import { PluginModal, PluginModalHeader } from './PluginDialogs'
import {
  PluginAvatar,
  PluginBadge,
  PluginSwitch,
  StatusPill,
  pluginButton,
  type BadgeTone,
  type PillTone
} from './PluginPrimitives'
import {
  isSecretField,
  missingEnvKeys,
  validateMcpServerForm,
  type McpFormError,
  type McpKeyValue,
  type McpServerForm
} from './mcp-server-form'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type McpConfigSheetProps = {
  t: Translate
  mode: 'install' | 'edit'
  title: string
  initial: McpServerForm
  requiredKeys: readonly string[]
  sourceBadge?: { tone: BadgeTone; label: string }
  statusPill?: { tone: PillTone; label: string }
  pinned?: { packageName: string; version: string }
  lastError?: string
  busy: boolean
  saveError?: string
  onCancel: () => void
  onSave: (form: McpServerForm) => void
  onDelete?: () => void
}

const inputBase = 'h-9 w-full min-w-0 rounded-[9px] border bg-ds-card px-2.5 text-[13px] text-ds-ink outline-none transition focus-visible:outline-none focus:border-[#6f8bff] focus:ring-[3px] focus:ring-accent-soft'

function errorText(t: Translate, error: McpFormError): string {
  switch (error.code) {
    case 'command-required': return t('pluginsErrCommand')
    case 'url-https': return t('pluginsErrUrl')
    case 'env-key-invalid': return t('pluginsErrEnvKey', { key: error.key || '""' })
    case 'env-key-duplicate': return t('pluginsErrEnvDup', { key: error.key })
    case 'header-name-required': return t('pluginsErrHeader')
  }
}

function KeyValueRows({ t, rows, keyPlaceholder, onChange, secretValues }: {
  t: Translate
  rows: McpKeyValue[]
  keyPlaceholder: string
  secretValues: boolean
  onChange: (rows: McpKeyValue[]) => void
}): ReactElement {
  const update = (index: number, patch: Partial<McpKeyValue>): void =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_32px] items-center gap-2">
          <input aria-label={keyPlaceholder} placeholder={keyPlaceholder} value={row.key} spellCheck={false} onChange={(event) => update(index, { key: event.target.value })} className={`${inputBase} border-ds-border font-mono text-[12.5px]`} />
          <input aria-label={t('pluginsEnvValuePlaceholder')} placeholder={t('pluginsEnvValuePlaceholder')} value={row.value} spellCheck={false} type={secretValues && isSecretField(row.key) ? 'password' : 'text'} onChange={(event) => update(index, { value: event.target.value })} className={`${inputBase} border-ds-border`} />
          <button type="button" aria-label={t('pluginsRemoveRow')} onClick={() => onChange(rows.filter((_, i) => i !== index))} className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function McpConfigSheet(props: McpConfigSheetProps): ReactElement {
  const { t, mode, initial, requiredKeys } = props
  const [form, setForm] = useState<McpServerForm>(() => ({
    ...initial,
    env: initial.transport === 'stdio' && requiredKeys.some((key) => !initial.env.some((row) => row.key === key))
      ? [...initial.env, ...requiredKeys.filter((key) => !initial.env.some((row) => row.key === key)).map((key) => ({ key, value: '' }))]
      : initial.env
  }))
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [advancedOpen, setAdvancedOpen] = useState(mode === 'edit')
  const [showErrors, setShowErrors] = useState(false)

  const required = useMemo(() => new Set(requiredKeys), [requiredKeys])
  const missing = form.transport === 'stdio' ? missingEnvKeys(form.env, requiredKeys) : []
  const errors = validateMcpServerForm(form)
  const otherEnv = form.env.filter((row) => !required.has(row.key))

  const setEnvValue = (key: string, value: string): void =>
    setForm((prev) => ({ ...prev, env: prev.env.map((row) => (row.key === key ? { ...row, value } : row)) }))
  const setOtherEnv = (rows: McpKeyValue[]): void =>
    setForm((prev) => ({ ...prev, env: [...prev.env.filter((row) => required.has(row.key)), ...rows] }))
  const toggleReveal = (key: string): void =>
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const save = (enable: boolean): void => {
    if (errors.length > 0) {
      setShowErrors(true)
      return
    }
    props.onSave({ ...form, enabled: enable && missing.length === 0 })
  }

  const title = mode === 'install' ? t('pluginsSheetAddTitle', { name: props.title }) : props.title
  const label = (text: string, htmlFor?: string): ReactElement => (
    <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-ds-ink">{text}</label>
  )

  return (
    <PluginModal label={title} onClose={props.onCancel}>
      <PluginModalHeader
        t={t}
        title={title}
        leading={<PluginAvatar id={form.id} title={props.title} size={42} />}
        onClose={props.onCancel}
        meta={(
          <>
            {props.sourceBadge ? <PluginBadge tone={props.sourceBadge.tone}>{props.sourceBadge.label}</PluginBadge> : null}
            {props.statusPill ? <StatusPill tone={props.statusPill.tone}>{props.statusPill.label}</StatusPill> : null}
            {props.pinned ? (
              <>
                <PluginBadge tone="ok">{t('pluginsPinned')}</PluginBadge>
                <span className="truncate font-mono">{props.pinned.packageName}@{props.pinned.version}</span>
              </>
            ) : null}
          </>
        )}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-[18px]">
        {mode === 'edit' && missing.length > 0 ? (
          <div className="flex gap-2.5 rounded-[10px] border border-[#f6dcb4] bg-[#fffaf2] px-3 py-2.5 text-[12.5px] leading-5 text-[#8a4b00] dark:border-[#5a4320] dark:bg-[#2c2416] dark:text-[#ffc985]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{t('pluginsNeedsKeysBanner', { keys: missing.join(', ') })}</span>
          </div>
        ) : null}
        {mode === 'edit' && props.lastError && missing.length === 0 ? (
          <div className="flex gap-2.5 rounded-[10px] border border-[#f5cdc8] bg-[#fff6f5] px-3 py-2.5 text-[12.5px] leading-5 text-[#9f2e26] dark:border-[#5a2a26] dark:bg-[#2c1a18] dark:text-[#ffaaa3]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{t('pluginsLastErrorBanner', { message: props.lastError })}</span>
          </div>
        ) : null}

        {form.transport === 'stdio' ? (
          <>
            {requiredKeys.length > 0 ? (
              <section>
                <h3 className="mb-2.5 mt-0 flex items-center gap-2 text-[12px] font-semibold tracking-wide text-ds-muted">
                  {t('pluginsRequired')}
                  {missing.length > 0 ? <PluginBadge tone="warn">{t('pluginsRequiredLeft', { count: missing.length })}</PluginBadge> : null}
                </h3>
                <div className="flex flex-col gap-3">
                  {requiredKeys.map((key) => {
                    const row = form.env.find((entry) => entry.key === key)
                    const value = row?.value ?? ''
                    const secret = isSecretField(key)
                    const empty = !value.trim()
                    const id = `mcp-env-${key}`
                    return (
                      <div key={key} className="flex flex-col gap-1.5">
                        <label htmlFor={id} className="font-mono text-[12.5px] font-semibold text-ds-ink">{key}</label>
                        <div className={`flex h-[38px] items-center rounded-[10px] border pl-3 pr-1 ${empty ? 'border-[#f0c48a] bg-[#fffaf2] dark:border-[#6b4f22] dark:bg-[#2c2416]' : 'border-ds-border bg-ds-card'} focus-within:border-[#6f8bff] focus-within:ring-[3px] focus-within:ring-accent-soft`}>
                          <input
                            id={id}
                            type={secret && !revealed.has(key) ? 'password' : 'text'}
                            value={value}
                            spellCheck={false}
                            autoComplete="off"
                            onChange={(event) => setEnvValue(key, event.target.value)}
                            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ds-ink outline-none focus-visible:outline-none"
                          />
                          {secret ? (
                            <button type="button" onClick={() => toggleReveal(key)} aria-label={revealed.has(key) ? t('pluginsHideSecret') : t('pluginsShowSecret')} className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                              {revealed.has(key) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          ) : null}
                        </div>
                        <span className={`text-[11.5px] ${empty ? 'text-[#a35a00] dark:text-[#ffc985]' : 'text-ds-muted'}`}>
                          {empty ? t('pluginsFieldMissing') : secret ? t('pluginsSecretHint') : ' '}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}
            <section>
              <h3 className="mb-2.5 mt-0 text-[12px] font-semibold tracking-wide text-ds-muted">
                {requiredKeys.length > 0 ? t('pluginsOptionalEnv') : t('pluginsEnvSection')}
              </h3>
              <KeyValueRows t={t} rows={otherEnv} keyPlaceholder={t('pluginsEnvKeyPlaceholder')} secretValues onChange={setOtherEnv} />
              <button type="button" onClick={() => setOtherEnv([...otherEnv, { key: '', value: '' }])} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-[12.5px] font-semibold text-[#3651cf] hover:bg-accent-soft dark:text-[#b7c4ff]">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                {t('pluginsAddEnv')}
              </button>
            </section>
            <section className="rounded-xl border border-ds-border-muted">
              <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left">
                {advancedOpen ? <ChevronDown className="h-4 w-4 text-ds-muted" /> : <ChevronRight className="h-4 w-4 text-ds-muted" />}
                <span className="text-[13px] font-semibold text-ds-ink">{mode === 'edit' ? t('pluginsLaunchSection') : t('pluginsAdvanced')}</span>
                <span className="min-w-0 truncate font-mono text-[12px] text-ds-muted">{[form.command, ...form.args].join(' ')}</span>
              </button>
              {advancedOpen ? (
                <div className="grid grid-cols-2 gap-2.5 px-3.5 pb-3.5">
                  <div className="flex flex-col gap-1.5">
                    {label(t('pluginsCommand'), 'mcp-command')}
                    <input id="mcp-command" value={form.command} spellCheck={false} onChange={(event) => setForm((prev) => ({ ...prev, command: event.target.value }))} className={`${inputBase} border-ds-border font-mono`} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {label(t('pluginsTimeout'), 'mcp-timeout')}
                    <input id="mcp-timeout" type="number" min={1} value={form.timeoutSec} onChange={(event) => setForm((prev) => ({ ...prev, timeoutSec: Number(event.target.value) || 30 }))} className={`${inputBase} border-ds-border`} />
                  </div>
                  <div className="col-span-2 flex flex-col gap-1.5">
                    {label(t('pluginsArgs'), 'mcp-args')}
                    <textarea id="mcp-args" rows={3} value={form.args.join('\n')} spellCheck={false} onChange={(event) => setForm((prev) => ({ ...prev, args: event.target.value.split('\n') }))} className="min-h-[64px] w-full rounded-[9px] border border-ds-border bg-ds-card px-2.5 py-2 font-mono text-[12.5px] leading-5 text-ds-ink outline-none focus-visible:outline-none focus:border-[#6f8bff] focus:ring-[3px] focus:ring-accent-soft" />
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              {label(t('pluginsUrl'), 'mcp-url')}
              <input id="mcp-url" value={form.url} spellCheck={false} onChange={(event) => setForm((prev) => ({ ...prev, url: event.target.value }))} className={`${inputBase} border-ds-border font-mono`} />
            </div>
            <section>
              <h3 className="mb-2.5 mt-0 text-[12px] font-semibold tracking-wide text-ds-muted">{t('pluginsHeaders')}</h3>
              <KeyValueRows t={t} rows={form.headers} keyPlaceholder={t('pluginsHeaderPlaceholder')} secretValues onChange={(headers) => setForm((prev) => ({ ...prev, headers }))} />
              <button type="button" onClick={() => setForm((prev) => ({ ...prev, headers: [...prev.headers, { key: '', value: '' }] }))} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-1.5 text-[12.5px] font-semibold text-[#3651cf] hover:bg-accent-soft dark:text-[#b7c4ff]">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                {t('pluginsAddHeader')}
              </button>
            </section>
            <div className="flex max-w-[180px] flex-col gap-1.5">
              {label(t('pluginsTimeout'), 'mcp-timeout')}
              <input id="mcp-timeout" type="number" min={1} value={form.timeoutSec} onChange={(event) => setForm((prev) => ({ ...prev, timeoutSec: Number(event.target.value) || 30 }))} className={`${inputBase} border-ds-border`} />
            </div>
          </>
        )}

        {mode === 'edit' ? (
          <div className="flex items-center gap-2.5">
            <PluginSwitch checked={form.enabled && missing.length === 0} disabled={missing.length > 0} label={t('pluginsEnable')} onChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))} />
            <span className="text-[13px] text-ds-ink">{t('pluginsEnable')}</span>
            {missing.length > 0 ? <span className="text-[12px] text-ds-muted">{t('pluginsEnableBlocked')}</span> : null}
          </div>
        ) : null}

        <div className="flex gap-2.5 rounded-[10px] bg-ds-subtle px-3 py-2.5 text-[12px] leading-5 text-ds-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('pluginsStorageNote')}</span>
        </div>
        {showErrors && errors.length > 0 ? (
          <ul className="m-0 list-none rounded-[10px] border border-[#f5cdc8] bg-[#fff6f5] px-3 py-2 text-[12.5px] leading-5 text-[#9f2e26] dark:border-[#5a2a26] dark:bg-[#2c1a18] dark:text-[#ffaaa3]">
            {errors.map((error, index) => <li key={index}>{errorText(t, error)}</li>)}
          </ul>
        ) : null}
        {props.saveError ? (
          <div role="alert" className="rounded-[10px] border border-[#f5cdc8] bg-[#fff6f5] px-3 py-2 text-[12.5px] leading-5 text-[#9f2e26] dark:border-[#5a2a26] dark:bg-[#2c1a18] dark:text-[#ffaaa3]">{props.saveError}</div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-ds-border-muted px-6 py-3.5">
        {mode === 'edit' && props.onDelete ? (
          <button type="button" className={pluginButton.danger} onClick={props.onDelete}>{t('pluginsDelete')}</button>
        ) : null}
        <span className="min-w-0 flex-1" />
        <button type="button" className={pluginButton.base} onClick={props.onCancel}>{t('pluginsCancel')}</button>
        {mode === 'install' ? (
          <>
            {missing.length > 0 ? (
              <button type="button" disabled={props.busy} className={pluginButton.base} onClick={() => save(false)}>{t('pluginsSaveLater')}</button>
            ) : null}
            <button type="button" disabled={props.busy || missing.length > 0} className={pluginButton.dark} onClick={() => save(true)}>
              {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('pluginsSaveEnable')}
            </button>
          </>
        ) : (
          <button type="button" disabled={props.busy} className={pluginButton.dark} onClick={() => save(form.enabled)}>
            {props.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('pluginsSave')}
          </button>
        )}
      </div>
    </PluginModal>
  )
}
