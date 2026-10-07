import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ExternalLink, Loader2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import { harnessRowUnavailableCode, loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { AgentIcon } from '../agent-icon'
import { setupInstallCommand, setupLoginCommand } from './agent-center-actions'
import { agentIntegrationKind } from './agent-center-catalog'
import { AgentCenterCustomForm } from './agent-center-custom-form'
import { AgentInstallControl } from './AgentInstallControl'

const STATE_KEY = 'kun-agent-add-wizard-v1'
const CHECK_TTL_MS = 10 * 60 * 1_000

type AddKind = 'builtin' | 'custom'
type Step = 'choose' | 'connect' | 'finish'
type Check = {
  id: string
  fingerprint: string
  level: 'handshake' | 'trial' | 'probe' | 'saved'
  ok: boolean
  detail?: string
  durationMs?: number
  checkedAt: number
}
type WizardState = { step: Step; kind: AddKind; selectedId: string; check?: Check }

const initialState: WizardState = { step: 'choose', kind: 'builtin', selectedId: '' }

function readState(): WizardState {
  if (typeof window === 'undefined') return initialState
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STATE_KEY) ?? '{}') as Partial<WizardState>
    if (!['choose', 'connect', 'finish'].includes(parsed.step ?? '') ||
      !['builtin', 'custom'].includes(parsed.kind ?? '')) return initialState
    return {
      step: parsed.step!,
      kind: parsed.kind!,
      selectedId: typeof parsed.selectedId === 'string' ? parsed.selectedId : '',
      ...(parsed.check && typeof parsed.check.checkedAt === 'number' ? { check: parsed.check } : {})
    }
  } catch {
    return initialState
  }
}

function fingerprint(row: AdeHarnessRow | undefined, binaryPath: string | undefined, defaults?: unknown): string {
  return JSON.stringify({
    id: row?.definition.id,
    transport: row?.definition.transport,
    command: row?.status.resolvedCommand,
    version: row?.status.version,
    binaryPath, defaults
  })
}

/** Three-step flow. Only a real handshake or an explicit trial earns a passed label. */
export function AgentCenterAddWizard({
  rows,
  settings,
  updateKun,
  onSetupCommand,
  onSelectAgent,
  onClose,
  settingsSurface = false
}: {
  rows: AdeHarnessRow[]
  settings: KunHarnessSettingsV1
  updateKun: (patch: { harnesses?: Partial<KunHarnessSettingsV1> }) => void
  onSetupCommand?: (harnessId: string, command: string, title: string) => void
  onSelectAgent: (id: string) => void
  onClose: () => void
  settingsSurface?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const { t: tSettings } = useTranslation('settings')
  const [state, setState] = useState(readState)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const activeCheck = useRef<AbortController | null>(null)
  const row = rows.find((candidate) => candidate.definition.id === state.selectedId)
  const checkFingerprint = fingerprint(row, settings.binaryPaths[state.selectedId], settings.defaults[state.selectedId])
  const checkFresh = Boolean(state.check && state.check.id === state.selectedId &&
    (state.kind !== 'builtin' || state.check.fingerprint === checkFingerprint) &&
    Date.now() - state.check.checkedAt < CHECK_TTL_MS)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try { window.sessionStorage.setItem(STATE_KEY, JSON.stringify(state)) }
    catch { /* The wizard still works when session storage is blocked. */ }
  }, [state])
  useEffect(() => {
    generation.current += 1
    activeCheck.current?.abort()
    activeCheck.current = null
    setBusy(false)
  }, [checkFingerprint])
  useEffect(() => () => {
    generation.current += 1
    activeCheck.current?.abort()
  }, [])

  const update = (next: WizardState): void => {
    generation.current += 1
    activeCheck.current?.abort()
    activeCheck.current = null
    setBusy(false)
    setError('')
    setState(next)
  }
  const close = (): void => {
    generation.current += 1
    activeCheck.current?.abort()
    activeCheck.current = null
    onClose()
  }
  const finish = (): void => {
    if (state.selectedId) onSelectAgent(state.selectedId)
    if (typeof window !== 'undefined') {
      try { window.sessionStorage.removeItem(STATE_KEY) } catch { /* ignore */ }
    }
    close()
  }
  const choose = (kind: AddKind, id = ''): void => {
    update({ step: 'connect', kind, selectedId: id })
  }

  const check = async (level: 'handshake' | 'trial'): Promise<void> => {
    if (!row) return
    const testHarness = getProvider().testHarness
    if (!testHarness) {
      setError(t('agentAdd.checkUnavailable'))
      return
    }
    const currentGeneration = ++generation.current
    activeCheck.current?.abort()
    const controller = new AbortController()
    activeCheck.current = controller
    const currentId = row.definition.id
    const currentFingerprint = checkFingerprint
    setBusy(true)
    setError('')
    try {
      const result = await testHarness(currentId, {
        level,
        credentialMode: settings.defaults[currentId]?.credentialMode ?? row.definition.credentialModes[0],
        ...(settings.defaults[currentId]?.providerId ? { providerId: settings.defaults[currentId]!.providerId } : {}),
        ...(settings.defaults[currentId]?.model ? { model: settings.defaults[currentId]!.model } : {}),
        timeoutMs: 55_000
      }, { signal: controller.signal })
      if (generation.current !== currentGeneration) return
      const detail = result.readiness?.detail ?? result.trial?.error ?? result.handshake?.detail ?? result.detect.status.message
      setState({
        step: 'finish', kind: 'builtin', selectedId: currentId,
        check: {
          id: currentId,
          fingerprint: currentFingerprint,
          level,
          ok: result.ok && (level === 'trial'
            ? result.trial?.ok === true && result.trial.status === 'completed'
            : result.readiness?.usable === true),
          ...(detail ? { detail } : {}),
          durationMs: result.durationMs,
          checkedAt: Date.now()
        }
      })
      void loadHarnesses(true)
    } catch (cause) {
      if (generation.current === currentGeneration) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (activeCheck.current === controller) activeCheck.current = null
      if (generation.current === currentGeneration) setBusy(false)
    }
  }

  const setupCommand = (kind: 'install' | 'login'): void => {
    if (!row) return
    const selected = kind === 'install'
      ? setupInstallCommand(row.definition.setup, window.kunGui?.platform ?? 'darwin')
      : setupLoginCommand(row.definition.setup)
    if (!selected) return
    if (onSetupCommand) {
      onSetupCommand(row.definition.id, selected.command, row.definition.displayName)
    } else {
      void navigator.clipboard?.writeText(selected.command)
      setError(selected.command)
    }
    close()
  }

  const completeCustom = (id: string, probe: { ok: boolean; detail?: string; durationMs: number } | null): void => {
    update({
      step: 'finish', kind: 'custom', selectedId: id,
      check: {
        id, fingerprint: fingerprint(undefined, undefined),
        level: probe ? 'probe' : 'saved',
        ok: probe?.ok === true,
        ...(probe?.detail ? { detail: probe.detail } : {}),
        ...(probe ? { durationMs: probe.durationMs } : {}),
        checkedAt: Date.now()
      }
    })
    void loadHarnesses(true)
  }

  const actionClass = 'rounded-lg border border-ds-border px-3 py-1.5 text-[12px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45'
  const kindLabel = state.kind === 'custom' ? t('agentAdd.customAcp') : row?.definition.displayName ?? ''
  const content = (
    <div role="dialog" aria-modal="true" aria-label={t('agentAdd.title')} data-agent-add-wizard className={`${settingsSurface ? 'ds-settings-surface ' : ''}fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3 md:p-6`}>
      <div className="flex max-h-[min(90vh,760px)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-ds-border px-4 py-3">
          {state.step !== 'choose' ? (
            <button data-settings-action="ghost" data-settings-size="icon" type="button" onClick={() => update({ ...state, step: state.step === 'finish' ? 'connect' : 'choose' })} aria-label={t('agentAdd.back')} className="rounded-md p-1 text-ds-muted hover:bg-ds-hover">
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ds-ink">{t('agentAdd.title')}</h2>
          <button data-settings-action="ghost" data-settings-size="icon" type="button" onClick={close} aria-label={t('agentAdd.cancel')} data-agent-add-close className="rounded-md p-1 text-ds-muted hover:bg-ds-hover"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex shrink-0 gap-2 border-b border-ds-border-muted px-4 py-2 text-[11px] text-ds-faint">
          {(['choose', 'connect', 'finish'] as const).map((step, index) => (
            <span key={step} className={state.step === step ? 'font-semibold text-accent' : ''}>{index + 1}. {t(`agentAdd.${step}`)}</span>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {state.step === 'choose' ? (
            <div className="space-y-2" data-agent-add-choose>
              {rows.filter((candidate) => candidate.definition.builtin && candidate.definition.id !== 'kun' && candidate.definition.id !== 'gemini-cli' && candidate.definition.availability !== 'retired' && agentIntegrationKind(candidate) === 'chat').map((candidate) => {
                return (
                  <button key={candidate.definition.id} type="button" onClick={() => choose('builtin', candidate.definition.id)} data-agent-add-select={candidate.definition.id} className="flex w-full items-center gap-3 rounded-xl border border-ds-border px-3 py-2 text-left text-ds-ink hover:bg-ds-hover">
                    <AgentIcon harnessId={candidate.definition.id} size={20} />
                    <span className="min-w-0 flex-1 truncate text-[13px]">{candidate.definition.displayName}</span>
                    <span className="shrink-0 text-[11px] text-ds-faint">{candidate.status.installed === 'yes' ? t('agentAdd.installed') : t('agentAdd.unverified')}</span>
                  </button>
                )
              })}
              <div className="grid grid-cols-2 gap-2 border-t border-ds-border-muted pt-3">
                <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => choose('custom')} className={actionClass} data-agent-add-custom>{t('agentAdd.customAcp')}</button>
                <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => choose('custom')} className={actionClass} data-agent-add-import>{t('agentAdd.import')}</button>
              </div>
            </div>
          ) : null}
          {state.step === 'connect' ? (
            <div className="space-y-3" data-agent-add-connect>
              <h3 className="text-[13px] font-semibold text-ds-ink">{kindLabel}</h3>
              {state.kind === 'custom' ? (
                <AgentCenterCustomForm settings={settings} updateKun={updateKun} t={tSettings} onSaved={completeCustom} />
              ) : row ? (
                <>
                  <p className="text-[12px] text-ds-muted">{row.definition.credentialModes[0] === 'native-login'
                    ? t('adeCredential.nativeLogin') : row.definition.credentialModes[0] === 'provider'
                      ? t('adeCredential.provider') : t('adeCredential.kunGateway')}</p>
                  <p className="text-[12px] text-ds-muted">{row.status.message ?? (harnessRowUnavailableCode(row) ? t('agentAdd.unverified') : t('agentAdd.checkPassed'))}</p>
                  {row.definition.builtin && (row.definition.setup?.install?.length || row.definition.setup?.adapter) ? <AgentInstallControl
                    key={row.definition.id} harnessId={row.definition.id} action={harnessRowUnavailableCode(row) === 'adapter_missing' ? 'adapter' : 'install'}
                    needed={row.status.installed !== 'yes' || row.status.versionSupported === false} t={t} /> : null}
                  <div className="flex flex-wrap gap-2">
                    {row.definition.setup?.install ? <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => setupCommand('install')} className={actionClass}>{t('agentAdd.installInTerminal')}</button> : null}
                    {row.definition.setup?.login ? <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => setupCommand('login')} className={actionClass}>{t('agentAdd.loginInTerminal')}</button> : null}
                    <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => {
                      onSelectAgent(row.definition.id)
                      close()
                    }} className={actionClass}>{t('agentAdd.openSettings')} <ExternalLink className="inline h-3 w-3" /></button>
                  </div>
                  <button aria-busy={busy} data-settings-action="primary" data-settings-size="default" type="button" disabled={busy} onClick={() => void check('handshake')} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-45" data-agent-add-check>
                    {busy ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}{busy ? t('agentAdd.checking') : t('agentAdd.check')}
                  </button>
                </>
              ) : <p className="text-[12px] text-ds-muted">{t('agentAdd.unverified')}</p>}
            </div>
          ) : null}
          {state.step === 'finish' ? (
            <div className="space-y-3" data-agent-add-finish>
              <div className="flex items-center gap-2"><AgentIcon harnessId={state.selectedId} size={24} /><h3 className="text-[14px] font-semibold text-ds-ink">{kindLabel || state.selectedId}</h3></div>
              <p className="text-[12px] text-ds-muted" data-agent-add-check-state={checkFresh && state.check?.ok ? 'passed' : state.check?.ok ? 'stale' : 'unverified'}>{checkFresh && state.check?.ok ? t(state.check.level === 'trial' ? 'agentAdd.trialPassed' : 'agentAdd.checkPassed')
                  : state.check?.ok ? t('agentAdd.checkStale') : t('agentAdd.savedUnready')}</p>
              {state.check?.durationMs !== undefined ? <p className="text-[11px] text-ds-faint">{state.check.durationMs} ms</p> : null}
              {state.check?.detail ? <p role="alert" className="break-words text-[12px] text-ds-status-danger">{state.check.detail}</p> : null}
              <p className="text-[11px] text-ds-faint">{t('agentAdd.trialWarning')}</p>
              <div className="flex flex-wrap gap-2">
                {state.kind === 'builtin' ? <button aria-busy={busy} data-settings-action="secondary" data-settings-size="default" type="button" disabled={busy} onClick={() => void check('trial')} className={actionClass} data-agent-add-trial>{t('agentAdd.trial')}</button> : null}
                <button data-settings-action="secondary" data-settings-size="default" type="button" onClick={() => void loadHarnesses(true)} className={actionClass}>{t('agentAdd.retry')}</button>
                <button data-settings-action="primary" data-settings-size="default" type="button" onClick={finish} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white" data-agent-add-done>{t('agentAdd.done')}</button>
              </div>
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-3 text-[12px] text-ds-status-danger">{error}</p> : null}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
