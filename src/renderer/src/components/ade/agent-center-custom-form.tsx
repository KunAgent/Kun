import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import type {
  KunHarnessCustomEntryV1,
  KunHarnessSecretEnvEntryV1,
  KunHarnessSettingsV1
} from '@shared/app-settings'
import type { AdeHarnessProbeDefinitionResult } from '@shared/ade-harnesses'
import { getProvider } from '../../agent/registry'
import { loadHarnesses, useHarnessStore } from '../../store/harness-store'

type T = (key: string, options?: Record<string, unknown>) => string

type ProbeStamp = { fingerprint: string; result: AdeHarnessProbeDefinitionResult }

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const CUSTOM_DRAFT_KEY = 'kun-agent-custom-draft-v1'
const AGENT_ID = /^[a-z][a-z0-9-]{1,47}$/

type PersistedCustomDraft = {
  id?: string
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

export function customAgentId(displayName: string): string {
  return `custom-${displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'}`
}

/** What the probe actually tested — stale once any field changes. */
function fingerprintOf(
  id: string,
  displayName: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  secretEnv: KunHarnessSecretEnvEntryV1[]
): string {
  return JSON.stringify({
    id,
    displayName,
    command,
    args,
    env: Object.fromEntries(Object.entries(env).sort(([a], [b]) => a.localeCompare(b))),
    secretEnv: [...secretEnv].sort((a, b) => a.name.localeCompare(b.name))
  })
}

export function parseEnvLines(text: string): Record<string, string> | null {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return null
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

/** Minimal shape validation for an imported definition JSON. */
export function parseCustomEntryJson(text: string): KunHarnessCustomEntryV1 | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const entry = raw as Record<string, unknown>
  if (
    typeof entry.displayName !== 'string' ||
    !entry.displayName.trim() ||
    typeof entry.command !== 'string' ||
    !entry.command.trim()
  ) {
    return null
  }
  const env = typeof entry.env === 'object' && entry.env !== null && !Array.isArray(entry.env)
    ? Object.fromEntries(
        Object.entries(entry.env as Record<string, unknown>).filter(
          ([k, v]) => ENV_NAME.test(k) && typeof v === 'string'
        ) as [string, string][]
      )
    : {}
  const secretEnv = Array.isArray(entry.secretEnv)
    ? (entry.secretEnv as unknown[]).flatMap((row): KunHarnessSecretEnvEntryV1[] => {
        if (typeof row !== 'object' || row === null) return []
        const r = row as Record<string, unknown>
        return typeof r.name === 'string' && ENV_NAME.test(r.name) &&
          typeof r.secretRef === 'string' && r.secretRef.trim()
          ? [{ name: r.name, secretRef: r.secretRef.trim() }]
          : []
      })
    : []
  return {
    id: typeof entry.id === 'string' && AGENT_ID.test(entry.id.trim())
      ? entry.id.trim()
      : customAgentId(entry.displayName),
    displayName: entry.displayName.trim(),
    command: entry.command.trim(),
    args: Array.isArray(entry.args)
      ? (entry.args as unknown[]).filter((a): a is string => typeof a === 'string')
      : [],
    env,
    secretEnv
  }
}

/**
 * "Add custom ACP agent" form (docs/ade/impl/p4 §3.7, P4-12): fields,
 * `secretEnv` credential-store bindings, test-before-save, and JSON
 * import. Persists under agents.kun.harnesses.custom.
 */
export function AgentCenterCustomForm({
  settings,
  updateKun,
  t,
  onSaved
}: {
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  t: T
  onSaved?: (id: string, probe: AdeHarnessProbeDefinitionResult | null) => void
}): ReactElement {
  const [initialDraft] = useState(readCustomDraft)
  const [draftId, setDraftId] = useState(initialDraft.id ?? '')
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
        id: draftId || undefined, name, command, args, env, secretEnv
      } satisfies PersistedCustomDraft))
    } catch {
      // A blocked session store must not prevent editing the form.
    }
  }, [draftId, name, command, args, env, secretEnv])

  useEffect(() => () => {
    probeGeneration.current += 1
    activeProbe.current?.abort()
  }, [])

  const displayName = name.trim()
  const effectiveId = draftId || customAgentId(displayName)
  const cmd = command.trim()
  const argList = args.trim() ? args.trim().split(/\s+/) : []
  const envRecord = parseEnvLines(env) ?? {}
  const fingerprint = fingerprintOf(effectiveId, displayName, cmd, argList, envRecord, secretEnv)
  const probeFresh = probe?.fingerprint === fingerprint
  const canSave =
    displayName.length > 0 && cmd.length > 0 &&
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
    if (!displayName || !cmd) {
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
        displayName,
        command: cmd,
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
    if (!displayName || !cmd) {
      setError(t('adeSettings.acpFormRequired'))
      return
    }
    if (parsedEnv === null) {
      setError(t('adeSettings.acpFormEnvInvalid'))
      return
    }
    const id = effectiveId
    if (settings.custom.some((e) => e.id === id) ||
      settings.terminalAgents.some((e) => e.id === id) ||
      useHarnessStore.getState().rows.some((row) => row.definition.id === id)) {
      setError(t('adeSettings.acpFormDuplicate'))
      return
    }
    const entry: KunHarnessCustomEntryV1 = {
      id,
      displayName,
      command: cmd,
      args: argList,
      env: parsedEnv,
      secretEnv
    }
    saveSubmitted.current = true
    try {
      updateKun({ harnesses: { ...settings, custom: [...settings.custom, entry] } })
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
    'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none'
  const subButtonClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="space-y-2.5" data-agent-custom-form>
      <input className={inputClass} value={name} spellCheck={false}
        placeholder={t('adeSettings.acpFormName')}
        onChange={(e) => { setName(e.target.value); invalidate() }} />
      <div className="flex items-center gap-2">
        <input className={`${inputClass} font-mono text-[12px]`} value={command} spellCheck={false}
          placeholder={t('adeSettings.acpFormCommand')}
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
      <input className={`${inputClass} font-mono text-[12px]`} value={args} spellCheck={false}
        placeholder={t('adeSettings.acpFormArgs')}
        onChange={(e) => { setArgs(e.target.value); invalidate() }} />
      <div>
        <textarea className={`${inputClass} resize-none font-mono text-[12px]`} value={env}
          rows={2} spellCheck={false}
          placeholder={t('adeSettings.acpFormEnv')}
          onChange={(e) => { setEnv(e.target.value); invalidate() }} />
        <div className="mt-1 text-[11px] text-ds-faint">{t('adeSettings.acpFormEnvNoSecrets')}</div>
      </div>

      {secretEnv.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {secretEnv.map((row) => (
            <span
              key={row.name}
              data-secret-env-chip={row.name}
              className="inline-flex items-center gap-1.5 rounded-full border border-ds-border-muted px-2.5 py-1 text-[11px] font-mono text-ds-muted"
            >
              {row.name}
              <button data-settings-action="danger-ghost" data-settings-size="icon"
                type="button"
                className="text-ds-faint transition hover:text-red-500"
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
          className={`${inputClass} max-w-[160px] font-mono text-[12px]`}
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
      <div className="text-[11px] text-ds-faint">{t('adeSettings.acpFormSecretHint')}</div>

      {probe && probeFresh ? (
        <div
          className={`rounded-lg border px-3 py-2 text-[12px] ${
            probe.result.ok
              ? 'border-emerald-200/80 bg-emerald-50/60 text-emerald-800 dark:border-emerald-800/40 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'border-red-200/80 bg-red-50/80 text-red-700 dark:border-red-800/40 dark:bg-red-500/10 dark:text-red-300'
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
      ) : null}
      {probe && !probeFresh ? (
        <div className="text-[11px] text-ds-faint">{t('adeSettings.acpFormProbeStale')}</div>
      ) : null}

      {error ? <div className="text-[12px] text-red-600 dark:text-red-400">{error}</div> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button aria-busy={probing} data-settings-action="secondary" data-settings-size="default"
          type="button"
          className={subButtonClass}
          disabled={probing || !displayName || !cmd}
          onClick={() => void runProbe()}
        >
          {probing ? t('adeSettings.acpFormProbing') : t('adeSettings.acpFormTest')}
        </button>
        <button data-settings-action="primary" data-settings-size="default"
          type="button"
          onClick={save}
          disabled={!canSave}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('adeSettings.acpFormAdd')}
        </button>
        {probeFresh && probe && !probe.result.ok ? (
          <button data-settings-action="secondary" data-settings-size="default"
            type="button"
            className={subButtonClass}
            onClick={() => setSaveAnyway(true)}
          >
            {t('adeSettings.acpFormSaveAnyway')}
          </button>
        ) : null}
        <button data-settings-action="secondary" data-settings-size="default"
          type="button"
          className={subButtonClass}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('adeSettings.acpFormImport')}
        </button>
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

/**
 * Serialize a saved custom entry as the portable JSON definition (p4 §3.7).
 * `secretEnv` refs are machine-local credential-store ids — they export
 * verbatim so a same-profile re-import keeps working.
 */
export function exportCustomEntryJson(entry: KunHarnessCustomEntryV1): string {
  return `${JSON.stringify(
    {
      id: entry.id,
      displayName: entry.displayName,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      secretEnv: entry.secretEnv ?? []
    },
    null,
    2
  )}\n`
}

/** Save-as-dialog export for one custom entry (reuses file:save-as). */
export async function exportCustomEntry(entry: KunHarnessCustomEntryV1): Promise<void> {
  const dataBase64 = window.btoa(unescape(encodeURIComponent(exportCustomEntryJson(entry))))
  await window.kunGui?.saveWorkspaceFileAs?.({
    suggestedName: `${entry.id}.json`,
    dataBase64,
    mimeType: 'application/json'
  })
}
