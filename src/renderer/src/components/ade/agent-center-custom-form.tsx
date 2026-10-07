import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Plus, Upload } from 'lucide-react'
import type {
  KunHarnessCustomEntryV1,
  KunHarnessSecretEnvEntryV1,
  KunHarnessSettingsV1
} from '@shared/app-settings'
import type { AdeHarnessProbeDefinitionResult } from '@shared/ade-harnesses'
import { userAgentOverride } from '@shared/harness-provider-settings'
import { getProvider } from '../../agent/registry'
import { loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import { launchPreview } from './agent-launch-preview'
import { ENV_NAME, customAgentId, parseCustomEntryJson, parseEnvLines } from './agent-center-custom-entry'

export { customAgentId, exportCustomEntry, exportCustomEntryJson, parseCustomEntryJson, parseEnvLines } from './agent-center-custom-entry'

type T = (key: string, options?: Record<string, unknown>) => string

type ProbeStamp = { fingerprint: string; result: AdeHarnessProbeDefinitionResult }

const CUSTOM_DRAFT_KEY = 'kun-agent-custom-draft-v1'

type PersistedCustomDraft = {
  id?: string
  base?: string
  name?: string
  command?: string
  args?: string
  env?: string
  secretEnv?: KunHarnessSecretEnvEntryV1[]
}

function readCustomDraft(): PersistedCustomDraft {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.sessionStorage.getItem(CUSTOM_DRAFT_KEY) ?? '{}') as PersistedCustomDraft
  } catch {
    return {}
  }
}

/** What the probe actually tested — stale once any field changes. */
function fingerprintOf(
  id: string,
  base: string,
  displayName: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  secretEnv: KunHarnessSecretEnvEntryV1[]
): string {
  return JSON.stringify({
    id,
    base,
    displayName,
    command,
    args,
    env: Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))),
    secretEnv: [...secretEnv].sort((a, b) => a.name.localeCompare(b.name))
  })
}

/**
 * "Add custom ACP agent" form (docs/ade/impl/p4 §3.7, P4-12): fields,
 * `secretEnv` credential-store bindings, test-before-save, and JSON
 * import. "Based on" derives the Agent from a builtin ACP engine (its
 * protocol behaviour and default arguments, another command). Persists under
 * agents.kun.harnesses.providers (docs/ade/17 §4.3).
 */
export type CustomFormMode = 'free' | 'derive' | 'acp' | 'import'

export function AgentCenterCustomForm({
  settings,
  updateKun,
  t,
  tCommon,
  mode = 'free',
  onSaved
}: {
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  /** settings-ns translator (the acpForm* wording). */
  t: T
  /** common-ns translator for the Agent Center wording; falls back to `t`. */
  tCommon?: T
  /**
   * `derive` requires a base engine, `acp` has none, `import` starts from a
   * file; `free` is the original form with an optional base.
   */
  mode?: CustomFormMode
  onSaved?: (id: string, probe: AdeHarnessProbeDefinitionResult | null) => void
}): ReactElement {
  const tc = tCommon ?? t
  const [initialDraft] = useState(readCustomDraft)
  const [draftId, setDraftId] = useState(initialDraft.id ?? '')
  const [base, setBase] = useState(mode === 'acp' ? '' : initialDraft.base ?? '')
  const [name, setName] = useState(initialDraft.name ?? '')
  const [command, setCommand] = useState(initialDraft.command ?? '')
  const [args, setArgs] = useState(initialDraft.args ?? '')
  const [env, setEnv] = useState(initialDraft.env ?? '')
  const [secretEnv, setSecretEnv] = useState<KunHarnessSecretEnvEntryV1[]>(initialDraft.secretEnv ?? [])
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const [binding, setBinding] = useState(false)
  const [probe, setProbe] = useState<ProbeStamp | null>(null)
  const [probing, setProbing] = useState(false)
  const [saveAnyway, setSaveAnyway] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const probeGeneration = useRef(0)
  const activeProbe = useRef<AbortController | null>(null)
  const saveSubmitted = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.sessionStorage.setItem(CUSTOM_DRAFT_KEY, JSON.stringify({
        id: draftId || undefined, base: base || undefined, name, command, args, env, secretEnv
      } satisfies PersistedCustomDraft))
    } catch {
      // A blocked session store must not prevent editing the form.
    }
  }, [draftId, base, name, command, args, env, secretEnv])

  useEffect(() => () => {
    probeGeneration.current += 1
    activeProbe.current?.abort()
  }, [])

  const baseRows = useHarnessStore((state) => state.rows).filter((row) => row.definition.builtin &&
    row.definition.transport === 'acp' && row.definition.availability !== 'retired' && row.definition.launch)
  useEffect(() => {
    // Deriving needs a base engine; start from the first one that can be derived.
    if (mode === 'derive' && !base && baseRows[0]) setBase(baseRows[0].definition.id)
  }, [mode, base, baseRows])
  const baseCommand = baseRows.find((row) => row.definition.id === base)?.definition.launch?.command ?? ''
  const displayName = name.trim()
  const effectiveId = draftId || customAgentId(displayName)
  const cmd = command.trim()
  // The probe launches the base engine's command when a derived Agent leaves it empty.
  const launchCommand = cmd || (base ? baseCommand : '')
  const argList = args.trim() ? args.trim().split(/\s+/) : []
  const envRecord = parseEnvLines(env) ?? {}
  const fingerprint = fingerprintOf(effectiveId, base, displayName, cmd, argList, envRecord, secretEnv)
  const probeFresh = probe?.fingerprint === fingerprint
  const canSave =
    displayName.length > 0 && launchCommand.length > 0 &&
    ((probeFresh && probe.result.ok) || (probeFresh && !probe.result.ok && saveAnyway))

  const invalidate = (): void => {
    probeGeneration.current += 1
    activeProbe.current?.abort()
    activeProbe.current = null
    saveSubmitted.current = false
    setProbing(false)
    setSaveAnyway(false)
  }

  const runProbe = async (): Promise<void> => {
    if (!displayName || !launchCommand) {
      setError(t('adeSettings.acpFormRequired'))
      return
    }
    if (parseEnvLines(env) === null) {
      setError(t('adeSettings.acpFormEnvInvalid'))
      return
    }
    const probeDefinition = getProvider().probeHarnessDefinition
    if (!probeDefinition) {
      setError(t('adeSettings.acpFormProbeUnavailable'))
      return
    }
    setError('')
    setProbing(true)
    const generation = ++probeGeneration.current
    activeProbe.current?.abort()
    const controller = new AbortController()
    activeProbe.current = controller
    try {
      const result = await probeDefinition({
        id: effectiveId,
        ...(base ? { extends: base } : {}),
        displayName,
        command: launchCommand,
        args: argList,
        env: envRecord,
        secretEnv
      }, { signal: controller.signal })
      if (probeGeneration.current === generation) {
        setProbe({ fingerprint, result })
        setSaveAnyway(false)
      }
    } catch (e) {
      if (probeGeneration.current === generation) {
        setProbe({
          fingerprint,
          result: {
            durationMs: 0,
            ok: false,
            supported: true,
            detail: e instanceof Error ? e.message : String(e)
          }
        })
      }
    } finally {
      if (activeProbe.current === controller) activeProbe.current = null
      if (probeGeneration.current === generation) setProbing(false)
    }
  }

  const bindSecret = async (): Promise<void> => {
    const envName = secretName.trim()
    const value = secretValue
    if (!ENV_NAME.test(envName) || !value) {
      setError(t('adeSettings.acpFormSecretInvalid'))
      return
    }
    const store = getProvider().storeHarnessSecret
    if (!store) {
      setError(t('adeSettings.acpFormProbeUnavailable'))
      return
    }
    setError('')
    setBinding(true)
    try {
      const secretRef = await store(value)
      setSecretEnv((rows) => {
        // Release the credential a replaced row pointed at; best-effort —
        // an orphan is harmless, the settings row is already gone.
        const replaced = rows.find((row) => row.name === envName)
        if (replaced && replaced.secretRef !== secretRef) {
          void getProvider().deleteHarnessSecret?.(replaced.secretRef).catch(() => undefined)
        }
        return [...rows.filter((row) => row.name !== envName), { name: envName, secretRef }]
      })
      setSecretName('')
      setSecretValue('')
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBinding(false)
    }
  }

  const unbindSecret = (row: KunHarnessSecretEnvEntryV1): void => {
    setSecretEnv((rows) => rows.filter((entry) => entry.name !== row.name))
    invalidate()
    // Best-effort release of the stored credential; a failure only leaves an
    // orphaned ref — the settings row is already gone.
    void getProvider().deleteHarnessSecret?.(row.secretRef).catch(() => undefined)
  }

  const save = (): void => {
    if (saveSubmitted.current) return
    const parsedEnv = parseEnvLines(env)
    if (!displayName || !launchCommand) {
      setError(t('adeSettings.acpFormRequired'))
      return
    }
    if (parsedEnv === null) {
      setError(t('adeSettings.acpFormEnvInvalid'))
      return
    }
    const id = effectiveId
    if (settings.providers[id]?.extends ||
      useHarnessStore.getState().rows.some((row) => row.definition.id === id)) {
      setError(t('adeSettings.acpFormDuplicate'))
      return
    }
    const entry: KunHarnessCustomEntryV1 = {
      id,
      ...(base ? { extends: base } : {}),
      displayName,
      command: cmd,
      args: argList,
      env: parsedEnv,
      secretEnv
    }
    saveSubmitted.current = true
    try {
      updateKun({ harnesses: { ...settings, providers: { ...settings.providers, [id]: userAgentOverride(entry) } } })
      onSaved?.(id, probeFresh ? probe?.result ?? null : null)
    } catch (cause) {
      saveSubmitted.current = false
      setError(cause instanceof Error ? cause.message : String(cause))
      return
    }
    // The card list renders the runtime catalog, not settings — the saved
    // entry reaches it through settings hot-apply, so poll until it lands.
    if (getProvider().listHarnesses) {
      void (async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await loadHarnesses(true, { waitMs: 1_500 })
          const landed = useHarnessStore.getState().rows
            .some((row) => row.definition.id === id)
          if (landed) return
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      })()
    }
    setName('')
    setDraftId('')
    setBase('')
    setCommand('')
    setArgs('')
    setEnv('')
    setSecretEnv([])
    setProbe(null)
    setSaveAnyway(false)
    setError('')
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(CUSTOM_DRAFT_KEY) } catch { /* ignore */ }
    }
  }

  const importJson = async (file: File): Promise<void> => {
    const entry = parseCustomEntryJson(await file.text())
    if (!entry) {
      setError(t('adeSettings.acpFormImportInvalid'))
      return
    }
    setName(entry.displayName)
    setDraftId(entry.id)
    setBase(entry.extends ?? '')
    setCommand(entry.command)
    setArgs(entry.args.join(' '))
    setEnv(
      Object.entries(entry.env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n')
    )
    setSecretEnv(entry.secretEnv ?? [])
    setProbe(null)
    setSaveAnyway(false)
    setError('')
  }

  const inputClass =
    'h-9 w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 text-[13px] text-ds-ink shadow-sm placeholder:text-ds-faint focus:border-accent focus:outline-none'
  const subButtonClass =
    'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ds-border-muted px-3 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'
  const labelClass = 'mb-1.5 block text-[12.5px] font-semibold text-ds-ink'
  const hintClass = 'mt-1 text-[11px] leading-[1.45] text-ds-faint'
  const showBase = mode === 'derive' ? baseRows.length > 0 : mode === 'acp' ? false : baseRows.length > 0
  const secretNames = secretEnv.map((row) => row.name)
  const preview = launchPreview({ command: launchCommand, args: argList, env: envRecord, secretNames })

  return (
    <div className="space-y-4" data-agent-custom-form data-agent-custom-mode={mode}>
      {mode === 'import' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-ds-border px-3.5 py-3">
          <p className="min-w-0 text-[12.5px] text-ds-muted">{tc('agentCenter.addDialog.importHint')}</p>
          <button data-settings-action="secondary" data-settings-size="default" type="button" className={subButtonClass}
            onClick={() => fileInput.current?.click()} data-agent-import-pick>
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('adeSettings.acpFormImport')}
          </button>
        </div>
      ) : null}
      {showBase ? (
        <div data-agent-custom-base>
          <span id="agent-custom-base-label" className={labelClass}>{tc('agentCenter.addDialog.base')}</span>
          <AgentSettingsSelect label={t('adeSettings.acpFormBase')} value={base}
            onChange={(value) => { setBase(value); invalidate() }}
            options={[...(mode === 'derive' ? [] : [{ value: '', label: t('adeSettings.acpFormBaseGeneric') }]),
              ...baseRows.map((row) => ({ value: row.definition.id, label: row.definition.displayName }))]} />
          <div className={hintClass}>{t('adeSettings.acpFormBaseHint')}</div>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="agent-custom-name" className={labelClass}>{tc('agentCenter.addDialog.name')}</label>
          <input id="agent-custom-name" className={inputClass} value={name} spellCheck={false}
            placeholder={t('adeSettings.acpFormName')}
            onChange={(e) => { setName(e.target.value); invalidate() }} />
          <div className={hintClass}>{tc('agentCenter.addDialog.idHint', { id: effectiveId })}</div>
        </div>
        <div>
          <label htmlFor="agent-custom-command" className={labelClass}>{tc('agentCenter.addDialog.command')}</label>
          <div className="flex items-center gap-2">
            <input id="agent-custom-command" className={`${inputClass} font-mono text-[12px]`} value={command} spellCheck={false}
              placeholder={base && baseCommand ? t('adeSettings.acpFormCommandOptional', { command: baseCommand }) : t('adeSettings.acpFormCommand')}
              onChange={(e) => { setCommand(e.target.value); invalidate() }} />
            <button data-settings-action="secondary" data-settings-size="default"
              type="button"
              className={subButtonClass}
              onClick={() => {
                void window.kunGui?.pickLocalFiles?.().then((picked) => {
                  const path = picked?.paths?.[0]
                  if (path) { setCommand(path); invalidate() }
                })
              }}
            >
              {t('adeSettings.acpFormPickCommand')}
            </button>
          </div>
          <div className={hintClass}>{tc(base ? 'agentCenter.addDialog.commandHintBase' : 'agentCenter.addDialog.commandHint')}</div>
        </div>
      </div>
      <div>
        <label htmlFor="agent-custom-args" className={labelClass}>{tc('agentCenter.addDialog.args')}</label>
        <input id="agent-custom-args" className={`${inputClass} font-mono text-[12px]`} value={args} spellCheck={false}
          placeholder={t('adeSettings.acpFormArgs')}
          onChange={(e) => { setArgs(e.target.value); invalidate() }} />
      </div>
      <div>
        <label htmlFor="agent-custom-env" className={labelClass}>{tc('agentCenter.addDialog.env')}</label>
        <textarea id="agent-custom-env" className={`${inputClass} h-auto resize-none py-2 font-mono text-[12px]`} value={env}
          rows={2} spellCheck={false}
          placeholder={t('adeSettings.acpFormEnv')}
          onChange={(e) => { setEnv(e.target.value); invalidate() }} />
        <div className={hintClass}>{t('adeSettings.acpFormEnvNoSecrets')}</div>
      </div>

      <div>
        <span className={labelClass}>{tc('agentCenter.addDialog.secrets')}</span>
        {secretEnv.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {secretEnv.map((row) => (
              <span
                key={row.name}
                data-secret-env-chip={row.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-ds-border-muted px-2.5 py-1 text-[11px] font-mono text-ds-muted"
              >
                {row.name}
                <button data-settings-action="danger-ghost" data-settings-size="icon"
                  type="button"
                  className="text-ds-faint transition hover:text-ds-ink"
                  aria-label={`Remove ${row.name}`}
                  onClick={() => unbindSecret(row)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <input
            className={`${inputClass} max-w-[170px] font-mono text-[12px]`}
            value={secretName}
            spellCheck={false}
            placeholder={t('adeSettings.acpFormSecretName')}
            onChange={(e) => setSecretName(e.target.value.toUpperCase())}
          />
          <input
            type="password"
            className={`${inputClass} font-mono text-[12px]`}
            value={secretValue}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('adeSettings.acpFormSecretValue')}
            onChange={(e) => setSecretValue(e.target.value)}
          />
          <button aria-busy={binding} data-settings-action="secondary" data-settings-size="default"
            type="button"
            className={subButtonClass}
            disabled={binding || !secretName.trim() || !secretValue}
            onClick={() => void bindSecret()}
          >
            {t('adeSettings.acpFormSecretBind')}
          </button>
        </div>
        <div className={hintClass}>{t('adeSettings.acpFormSecretHint')}</div>
      </div>

      {preview ? (
        <div data-agent-custom-preview>
          <span className={labelClass}>{tc('agentCenter.addDialog.preview')}</span>
          <pre className="whitespace-pre-wrap break-all rounded-xl bg-ds-subtle px-3 py-2.5 font-mono text-[12px] leading-[1.6] text-ds-ink">{preview}</pre>
        </div>
      ) : null}

      {probe && probeFresh ? (
        <div
          role="status"
          className={`rounded-xl border px-3 py-2.5 text-[12.5px] ${
            probe.result.ok
              ? 'border-[color-mix(in_srgb,var(--ds-success)_35%,transparent)] bg-ds-success-soft text-ds-status-success'
              : 'border-[color-mix(in_srgb,var(--ds-danger)_35%,transparent)] bg-ds-danger-soft text-ds-status-danger'
          }`}
          data-probe-result={probe.result.ok ? 'ok' : 'failed'}
        >
          {probe.result.ok
            ? t('adeSettings.acpFormProbeOk', {
                name: probe.result.agent?.name ?? displayName,
                version: probe.result.agent?.version ?? '',
                ms: probe.result.durationMs
              })
            : t('adeSettings.acpFormProbeFailed', {
                detail: probe.result.detail ?? ''
              })}
        </div>
      ) : probe ? (
        <div className="text-[11.5px] text-ds-faint">{t('adeSettings.acpFormProbeStale')}</div>
      ) : (
        <div className="rounded-xl bg-ds-subtle px-3 py-2.5 text-[12.5px] text-ds-muted">{tc('agentCenter.addDialog.testFirst')}</div>
      )}

      {error ? <div role="alert" className="text-[12px] text-ds-status-danger">{error}</div> : null}

      <p className="text-[11.5px] text-ds-faint">{tc('agentCenter.addDialog.failureHint')}</p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {probeFresh && probe && !probe.result.ok ? (
          <button data-settings-action="secondary" data-settings-size="default"
            type="button"
            className={`${subButtonClass} mr-auto`}
            onClick={() => setSaveAnyway(true)}
          >
            {t('adeSettings.acpFormSaveAnyway')}
          </button>
        ) : null}
        <button aria-busy={probing} data-settings-action="secondary" data-settings-size="default"
          type="button"
          className={subButtonClass}
          disabled={probing || !displayName || !launchCommand}
          onClick={() => void runProbe()}
        >
          {probing ? t('adeSettings.acpFormProbing') : t('adeSettings.acpFormTest')}
        </button>
        <button data-settings-action="primary" data-settings-size="default"
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-control px-4 text-[12.5px] font-medium text-control-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('adeSettings.acpFormAdd')}
        </button>
        {mode === 'free' ? (
          <button data-settings-action="secondary" data-settings-size="default"
            type="button"
            className={subButtonClass}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('adeSettings.acpFormImport')}
          </button>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importJson(file)
          }}
        />
      </div>
    </div>
  )
}
