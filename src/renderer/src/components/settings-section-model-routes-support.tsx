import type { ModelRoutePoolV1 } from '@shared/app-settings'
import type { KunRuntimeSettingsSyncStatusPayload } from '@shared/kun-gui-api'
import type { TFunction } from 'i18next'
import { Check, Clipboard, Code2, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from './settings-controls'
import type {
  RoutePoolTestAttempt,
  RoutePoolTestRecord,
  RouteStatus,
  RouteTestTarget
} from './settings-section-model-routes'

type GatewayApiTab = 'models' | 'chat' | 'responses'

export function ApiCompatibilityPill({ children }: { children: string }): ReactElement {
  return <span className="rounded-full bg-ds-main px-2 py-1 font-mono text-[10px] text-ds-muted">{children}</span>
}

export function LocalGatewayApiDialog({
  baseUrl,
  modelId,
  copied,
  onClose,
  onCopy
}: {
  baseUrl: string
  modelId: string
  copied: boolean
  onClose: () => void
  onCopy: (value: string) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const [tab, setTab] = useState<GatewayApiTab>('chat')
  useEffect(() => {
    if (typeof globalThis.addEventListener !== 'function') return
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    globalThis.addEventListener('keydown', closeOnEscape)
    return () => globalThis.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const guide = gatewayApiGuide(tab, baseUrl, modelId, t)
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4 backdrop-blur-[1px]" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="local-api-dialog-title" className="grid max-h-[min(760px,calc(100vh-32px))] w-full max-w-4xl overflow-hidden rounded-2xl border border-ds-border bg-ds-card shadow-2xl shadow-slate-950/25">
        <header className="flex items-start justify-between gap-4 border-b border-ds-border-muted px-5 py-4">
          <div>
            <h2 id="local-api-dialog-title" className="flex items-center gap-2 text-[16px] font-semibold text-ds-ink"><Code2 className="h-4 w-4 text-accent" />{t('modelRoutes.apiDialogTitle')}</h2>
            <p className="mt-1 text-[12px] text-ds-muted">{t('modelRoutes.apiDialogDesc')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-ds-muted hover:bg-ds-hover hover:text-ds-ink" aria-label={t('modelRoutes.closeApiDocs')}><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 overflow-y-auto md:grid-cols-[196px_minmax(0,1fr)]">
          <aside className="border-b border-ds-border-muted bg-ds-main/35 p-3 md:border-b-0 md:border-r">
            <p className="px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.08em] text-ds-faint">{t('modelRoutes.endpoints')}</p>
            <div className="grid gap-1">
              <ApiGuideTab active={tab === 'models'} onClick={() => setTab('models')} method="GET" path="/models">{t('modelRoutes.modelList')}</ApiGuideTab>
              <ApiGuideTab active={tab === 'chat'} onClick={() => setTab('chat')} method="POST" path="/chat/completions">{t('modelRoutes.chatCompletions')}</ApiGuideTab>
              <ApiGuideTab active={tab === 'responses'} onClick={() => setTab('responses')} method="POST" path="/responses">{t('modelRoutes.responses')}</ApiGuideTab>
            </div>
            <div className="mt-4 rounded-lg border border-ds-border bg-ds-card p-2.5 text-[10.5px] leading-4 text-ds-muted">
              <div className="font-medium text-ds-ink">{t('modelRoutes.prerequisites')}</div>
              <p className="mt-1">{t('modelRoutes.prerequisitesDesc')}</p>
            </div>
          </aside>

          <div className="min-w-0 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2"><span className={`rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold ${guide.method === 'GET' ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200'}`}>{guide.method}</span><h3 className="font-mono text-[14px] font-semibold text-ds-ink">{guide.path}</h3></div>
                <p className="mt-2 text-[12px] leading-5 text-ds-muted">{guide.description}</p>
              </div>
              <span className="rounded-full bg-ds-main px-2 py-1 text-[10.5px] text-ds-muted">{t('modelRoutes.openAiCompatible')}</span>
            </div>

            <div className="mt-4 rounded-xl border border-ds-border bg-ds-main/45 p-3">
              <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-medium text-ds-muted">{t('modelRoutes.baseUrlLabel')}</span><button type="button" onClick={() => onCopy(baseUrl)} className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:opacity-80">{copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? t('modelRoutes.copied') : t('modelRoutes.copy')}</button></div>
              <code className="mt-1.5 block break-all font-mono text-[12px] text-ds-ink">{baseUrl}</code>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <InfoList title={t('modelRoutes.keyFields')} items={guide.fields} />
              <InfoList title={t('modelRoutes.responsesAndLimits')} items={guide.notes} />
            </div>

            <div className="mt-5 overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
              <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-2"><span className="text-[11px] font-medium text-slate-300">{t('modelRoutes.curlExample')}</span><button type="button" onClick={() => onCopy(guide.example)} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[10.5px] font-medium text-slate-100 hover:bg-white/15">{copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Clipboard className="h-3.5 w-3.5" />}{copied ? t('modelRoutes.copied') : t('modelRoutes.copyExample')}</button></div>
              <pre className="overflow-x-auto p-3 font-mono text-[11.5px] leading-5 text-slate-100"><code>{guide.example}</code></pre>
            </div>

            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100">{t('modelRoutes.apiSecurityWarning')}</p>
          </div>
        </div>
      </section>
    </div>
  )
}

function ApiGuideTab({
  active,
  method,
  path,
  children,
  onClick
}: {
  active: boolean
  method: 'GET' | 'POST'
  path: string
  children: string
  onClick: () => void
}): ReactElement {
  return <button type="button" onClick={onClick} className={`grid gap-1 rounded-lg px-2.5 py-2 text-left transition ${active ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:bg-ds-hover hover:text-ds-ink'}`}><span className="text-[11.5px] font-medium">{children}</span><span className="font-mono text-[10px]"><span className={method === 'GET' ? 'text-emerald-600' : 'text-accent'}>{method}</span> {path}</span></button>
}

function InfoList({ title, items }: { title: string; items: string[] }): ReactElement {
  return <section><h4 className="text-[11px] font-medium text-ds-ink">{title}</h4><ul className="mt-1.5 grid gap-1 text-[11px] leading-4 text-ds-muted">{items.map((item) => <li key={item} className="flex gap-1.5"><span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-ds-faint" />{item}</li>)}</ul></section>
}

function gatewayApiGuide(tab: GatewayApiTab, baseUrl: string, modelId: string, t: TFunction): {
  method: 'GET' | 'POST'
  path: string
  description: string
  fields: string[]
  notes: string[]
  example: string
} {
  if (tab === 'models') return {
    method: 'GET',
    path: '/models',
    description: t('modelRoutes.guideModelsDesc'),
    fields: [t('modelRoutes.guideModelsNoBody'), t('modelRoutes.guideModelsEnabledOnly')],
    notes: [t('modelRoutes.guideModelsResponse'), t('modelRoutes.guideModelsDisabled')],
    example: `curl --request GET ${baseUrl}/models`
  }
  if (tab === 'responses') return {
    method: 'POST',
    path: '/responses',
    description: t('modelRoutes.guideResponsesDesc'),
    fields: [
      t('modelRoutes.guideFieldModel', { modelId }),
      t('modelRoutes.guideResponsesInput'),
      t('modelRoutes.guideResponsesStream'),
      t('modelRoutes.guideResponsesOptional')
    ],
    notes: [t('modelRoutes.guideResponsesNonStreaming'), t('modelRoutes.guideResponsesStreaming')],
    example: buildGatewayResponsesCurlExample(baseUrl, modelId, t)
  }
  return {
    method: 'POST',
    path: '/chat/completions',
    description: t('modelRoutes.guideChatDesc'),
    fields: [
      t('modelRoutes.guideFieldModel', { modelId }),
      t('modelRoutes.guideChatMessages'),
      t('modelRoutes.guideChatStream'),
      t('modelRoutes.guideChatTools')
    ],
    notes: [
      t('modelRoutes.guideChatNonStreaming'),
      t('modelRoutes.guideChatStreaming'),
      t('modelRoutes.guideChatModelMissing')
    ],
    example: buildGatewayCurlExample(baseUrl, modelId, t)
  }
}

export function buildGatewayCurlExample(baseUrl: string, modelId: string, t: TFunction): string {
  return `curl --request POST ${baseUrl}/chat/completions \\
  --header 'Authorization: Bearer <LOCAL_GATEWAY_API_KEY>' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "model": "${modelId}",
    "messages": [
      { "role": "user", "content": ${JSON.stringify(t('modelRoutes.exampleChatPrompt'))} }
    ],
    "stream": false
  }'`
}

function buildGatewayResponsesCurlExample(baseUrl: string, modelId: string, t: TFunction): string {
  return `curl --request POST ${baseUrl}/responses \\
  --header 'Authorization: Bearer <LOCAL_GATEWAY_API_KEY>' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "model": "${modelId}",
    "input": ${JSON.stringify(t('modelRoutes.exampleResponsesPrompt'))},
    "stream": false
  }'`
}

export const inputClass = 'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/50'
export const compactInputClass = 'w-full min-w-0 rounded-lg border border-ds-border bg-ds-card px-2 py-1.5 text-[12px] text-ds-ink outline-none focus:border-accent/50'
export function Field({ label, children }: { label: string; children: ReactElement }): ReactElement { return <label className="grid gap-1.5 text-[11.5px] font-medium text-ds-muted"><span>{label}</span>{children}</label> }
export function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }): ReactElement { return <div className="flex items-center justify-between"><span>{label}</span><Toggle checked={checked} onChange={onChange} ariaLabel={label} /></div> }
export function uniqueValue(base: string, values: Set<string>): string { let value = base; let i = 2; while (values.has(value)) value = `${base}-${i++}`; return value }
export function parseCodes(value: string): number[] { return [...new Set(value.split(/[\s,]+/).map(Number).filter((code) => Number.isInteger(code) && code >= 400 && code <= 599))] }
export function validCodes(value: string): boolean {
  return value.split(/[\s,]+/).filter(Boolean).every((item) => /^\d{3}$/.test(item) && Number(item) >= 400 && Number(item) <= 599)
}
export function useValidatedTextDraft({
  scopeId,
  value,
  validate,
  onCommit
}: {
  scopeId: string
  value: string
  validate: (value: string) => string | undefined
  onCommit: (value: string) => void
}): {
  draft: string
  error: string
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
} {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    setDraft(value)
    setError('')
    setFocused(false)
  }, [scopeId])
  useEffect(() => {
    if (!focused) {
      setDraft(value)
      setError('')
    }
  }, [focused, value])
  const commit = useCallback((): boolean => {
    const normalized = draft.trim()
    const nextError = validate(normalized)
    if (nextError) {
      setError(nextError)
      return false
    }
    setError('')
    if (normalized !== value) onCommit(normalized)
    return true
  }, [draft, onCommit, validate, value])
  return {
    draft,
    error,
    onChange: setDraft,
    onFocus: () => setFocused(true),
    onBlur: () => { if (commit()) setFocused(false) },
    onKeyDown: (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      if (commit()) {
        setFocused(false)
        event.currentTarget.blur()
      }
    }
  }
}
export function reorderTarget(event: DragEvent, destination: number, pool: ModelRoutePoolV1, update: (patch: Partial<ModelRoutePoolV1>) => void): void { event.preventDefault(); const source = Number(event.dataTransfer.getData('text/route-target-index')); if (!Number.isInteger(source) || source === destination) return; const targets = [...pool.targets]; const [moved] = targets.splice(source, 1); targets.splice(destination, 0, moved); update({ targets }) }
export function runtimePoolMatches(selected: ModelRoutePoolV1 | undefined, runtime: ModelRoutePoolV1 | undefined): boolean {
  if (!selected || !runtime) return false
  const comparable = (pool: ModelRoutePoolV1): unknown => ({
    id: pool.id,
    name: pool.name,
    modelId: pool.modelId,
    enabled: pool.enabled,
    strategy: pool.strategy,
    targets: pool.targets.map((target) => ({
      id: target.id,
      providerId: target.providerId,
      modelId: target.modelId,
      enabled: target.enabled,
      weight: target.weight
    })),
    failurePolicy: {
      failoverHttpStatusCodes: pool.failurePolicy.failoverHttpStatusCodes,
      failoverOnNetworkError: pool.failurePolicy.failoverOnNetworkError,
      failoverOnTimeout: pool.failurePolicy.failoverOnTimeout,
      failoverOnAuthError: pool.failurePolicy.failoverOnAuthError
    },
    healthPolicy: {
      failureThreshold: pool.healthPolicy.failureThreshold,
      cooldownMs: pool.healthPolicy.cooldownMs,
      halfOpenMaxAttempts: pool.healthPolicy.halfOpenMaxAttempts
    }
  })
  return JSON.stringify(comparable(selected)) === JSON.stringify(comparable(runtime))
}
export function runtimeConfigurationMatches(
  expectedPools: readonly ModelRoutePoolV1[],
  expectedGatewayEnabled: boolean,
  status: RouteStatus | null
): boolean {
  if (!status || status.localGateway?.enabled !== expectedGatewayEnabled) return false
  const runtimePools = status.configuredPools ?? status.pools ?? []
  return expectedPools.length === runtimePools.length &&
    expectedPools.every((pool, index) => runtimePoolMatches(pool, runtimePools[index]))
}
export function routeStatusError(body: string, status: number, t: TFunction): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    return parsed.error?.message?.trim() || parsed.message?.trim() || t('modelRoutes.statusRequestFailed', { status })
  } catch {
    return body.trim() || t('modelRoutes.statusRequestFailed', { status })
  }
}
export function chainTestBlockedReason(input: {
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  status: RouteStatus | null
  statusError: string
  runtimeSyncStatus: KunRuntimeSettingsSyncStatusPayload | null
  configurationSynced: boolean
  selectedHasExecutableTarget: boolean
  invalidTargetCount: number
}, t: TFunction): string {
  if (input.saveStatus === 'error') return t('modelRoutes.blockedSaveFailed')
  if (input.saveStatus === 'saving') return t('modelRoutes.blockedSaving')
  if (!input.selectedHasExecutableTarget) {
    return input.invalidTargetCount > 0
      ? t('modelRoutes.blockedInvalidTargets', { count: input.invalidTargetCount })
      : t('modelRoutes.blockedNoTargets')
  }
  if (!input.configurationSynced && input.runtimeSyncStatus?.state === 'failed') {
    return input.runtimeSyncStatus.message
      ? t('modelRoutes.blockedSyncFailedWithMessage', { message: input.runtimeSyncStatus.message })
      : t('modelRoutes.blockedSyncFailed')
  }
  if (!input.status) return input.statusError
    ? t('modelRoutes.blockedRuntimeUnavailableWithMessage', { message: input.statusError })
    : t('modelRoutes.blockedRuntimeUnavailable')
  if (!input.configurationSynced) return t('modelRoutes.blockedWaitingForSync')
  return t('modelRoutes.blockedRuntimeNotReady')
}
export function testStatusLabel(status: RoutePoolTestRecord['status'], t: TFunction): string { return t(`modelRoutes.testStatus.${status}`) }
export function testStatusClass(status: RoutePoolTestRecord['status']): string { return status === 'succeeded' ? 'bg-emerald-50 text-emerald-700' : status === 'failed' ? 'bg-red-50 text-red-700' : 'bg-accent/10 text-accent' }
export function attemptStatusLabel(status: RoutePoolTestAttempt['status'], t: TFunction): string { return t(`modelRoutes.attemptStatus.${status}`) }
export function testProgress(test: RoutePoolTestRecord): number {
  if (test.status === 'succeeded' || test.status === 'failed') return 100
  if (test.status === 'queued' || test.totalTargets === 0) return 4
  return Math.max(8, Math.min(92, Math.round((test.attemptedTargets / test.totalTargets) * 100)))
}
export function formatTarget(target: RouteTestTarget): string { return `${target.providerId} / ${target.modelId}` }
