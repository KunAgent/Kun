import type { TFunction } from 'i18next'
import { BookOpen, Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { settingsButtonClass } from './settings-button'
import { GatewaySectionHead } from './gateway-section-head'
import {
  buildGatewayConnectExample,
  GATEWAY_CONNECT_FORMATS,
  GATEWAY_EXAMPLE_KINDS,
  GATEWAY_KEY_PLACEHOLDER,
  gatewayConnectBaseUrl,
  gatewayConnectEnv,
  type GatewayConnectFormat,
  type GatewayExampleKind
} from './gateway-connect-examples'

const ENDPOINTS = ['GET /models', 'POST /chat/completions', 'POST /responses', 'POST /messages', 'POST /v1beta/models/*']

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: readonly { id: T; label: string }[]
  onChange: (value: T) => void
}): ReactElement {
  return <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-ds-border bg-ds-main p-0.5">
    {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={option.id === value}
      onClick={() => onChange(option.id)}
      className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/30 ${option.id === value
        ? 'bg-ds-card text-ds-ink shadow-sm' : 'text-ds-muted hover:text-ds-ink'}`}>{option.label}</button>)}
  </div>
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }): ReactElement {
  return <div className="grid min-w-0 gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:gap-4">
    <div className="pt-1.5 text-[12px] font-medium text-ds-muted sm:text-right">{label}</div>
    <div className="grid min-w-0 justify-items-start gap-1.5">
      {children}
      {hint ? <p className="text-[11.5px] leading-5 text-ds-faint">{hint}</p> : null}
    </div>
  </div>
}

function useCopied(): [string | null, (id: string, value: string) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (id: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      globalThis.setTimeout(() => setCopied((current) => current === id ? null : current), 1_500)
    } catch { setCopied(null) }
  }
  return [copied, copy]
}

/**
 * Connecting any tool by hand: pick the API family it speaks, then copy the
 * address, key, model id and a ready snippet. Each value says where it goes.
 */
export function GatewayManualConnect({ t, origin, models, keyConfigured, keyPending, onCopyKey, onPrepareModels, onOpenGuide }: {
  t: TFunction
  /** The gateway origin, e.g. http://127.0.0.1:18899. */
  origin: string
  /** Public model ids the runtime exports. */
  models: string[]
  keyConfigured: boolean
  keyPending: boolean
  /** Copies the shared key through Electron Main; resolves true when it reached the clipboard. */
  onCopyKey: () => Promise<boolean>
  onPrepareModels: () => void
  onOpenGuide: () => void
}): ReactElement {
  const [format, setFormat] = useState<GatewayConnectFormat>('chat')
  const [kind, setKind] = useState<GatewayExampleKind>('shell')
  const [model, setModel] = useState(models[0] ?? '')
  const [keyCopied, setKeyCopied] = useState(false)
  const [copied, copy] = useCopied()
  useEffect(() => { if (!models.includes(model)) setModel(models[0] ?? '') }, [model, models])
  const baseUrl = gatewayConnectBaseUrl(origin, format)
  const env = gatewayConnectEnv(format)
  const example = buildGatewayConnectExample({ format, kind, origin, modelId: model || 'your-public-model-id', t })
  const copyKey = async (): Promise<void> => {
    setKeyCopied(false)
    if (await onCopyKey()) {
      setKeyCopied(true)
      globalThis.setTimeout(() => setKeyCopied(false), 2_000)
    }
  }
  const chip = 'flex min-w-0 max-w-full items-center gap-0.5 rounded-lg border border-ds-border bg-ds-main py-0.5 pl-2.5 pr-0.5'
  const copyButton = (id: string, value: string, label: string): ReactElement => <button type="button" aria-label={label} title={label}
    className={settingsButtonClass({ variant: 'ghost', size: 'inline-icon' })} onClick={() => void copy(id, value)}>
    {copied === id ? <Check className="h-3.5 w-3.5 text-ds-status-success" /> : <Copy className="h-3.5 w-3.5" />}
  </button>

  return <section className="grid min-w-0 gap-2.5" data-gateway-manual-connect>
    <GatewaySectionHead title={t('gatewaySetup.manualTitle')} description={t('gatewaySetup.manualDesc')}
      actions={<button type="button" className={settingsButtonClass({ size: 'compact' })} onClick={onOpenGuide}>
        <BookOpen className="h-3.5 w-3.5" />{t('modelRoutes.apiDocs')}
      </button>} />
    <div className="grid min-w-0 gap-3.5 rounded-2xl border border-ds-border bg-ds-card p-4">
      <Row label={t('gatewaySetup.format')} hint={t(`gatewaySetup.formatHints.${format}`)}>
        <Segmented label={t('gatewaySetup.format')} value={format} onChange={setFormat}
          options={GATEWAY_CONNECT_FORMATS.map((id) => ({ id, label: t(`gatewaySetup.formats.${id}`) }))} />
      </Row>
      <Row label="Base URL" hint={t('gatewaySetup.baseUrlHint', { env: env.baseUrl })}>
        <div className={chip}>
          <code className="min-w-0 truncate font-mono text-[12px] text-ds-ink" title={baseUrl}>{baseUrl}</code>
          {copyButton('base-url', baseUrl, t('gatewaySetup.copyAddress'))}
        </div>
      </Row>
      <Row label={t('gatewaySetup.key')} hint={t('gatewaySetup.keyHint', { env: env.key })}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className={`${chip} pr-2.5 text-[12px] text-ds-muted`}>
            <KeyRound className="mr-1 h-3.5 w-3.5 shrink-0" />{t('gatewaySetup.keyValue')}
            <span className="ml-1.5 text-ds-faint">· {keyConfigured ? t('gatewaySetup.keyConfigured') : t('gatewaySetup.keyNotConfigured')}</span>
          </span>
          <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={keyPending || !keyConfigured} onClick={() => void copyKey()}>
            {keyPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : keyCopied ? <Check className="h-3.5 w-3.5 text-ds-status-success" /> : <Copy className="h-3.5 w-3.5" />}
            {keyCopied ? t('gatewaySetup.keyCopied') : t('gatewaySetup.copyKey')}
          </button>
        </div>
      </Row>
      <Row label={t('gatewaySetup.model')} hint={models.length ? t('gatewaySetup.modelHint') : undefined}>
        {models.length ? <div className={chip}>
          <select aria-label={t('gatewaySetup.model')} value={model} onChange={(event) => setModel(event.target.value)}
            className="min-w-0 max-w-[28rem] truncate bg-transparent py-1 font-mono text-[12px] text-ds-ink outline-none">
            {models.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
          {copyButton('model', model, t('gatewaySetup.copyModel'))}
        </div> : <div className="flex flex-wrap items-center gap-2 text-[12px] text-ds-muted">
          {t('gatewaySetup.noModels')}
          <button type="button" className={settingsButtonClass({ variant: 'link', size: 'compact' })} onClick={onPrepareModels}>{t('gatewaySetup.prepareModels')}</button>
        </div>}
      </Row>
      <Row label={t('gatewaySetup.example')} hint={t('gatewaySetup.exampleHint', { placeholder: GATEWAY_KEY_PLACEHOLDER })}>
        <Segmented label={t('gatewaySetup.example')} value={kind} onChange={setKind}
          options={GATEWAY_EXAMPLE_KINDS.map((id) => ({ id, label: id === 'shell' ? t('gatewaySetup.exampleShell') : id === 'curl' ? 'curl' : id === 'python' ? 'Python' : 'Node' }))} />
        <div className="relative w-full min-w-0 overflow-hidden rounded-lg border border-ds-border bg-ds-main" data-gateway-example={`${format}:${kind}`}>
          <pre className="min-w-0 max-w-full overflow-x-auto py-2.5 pl-3 pr-10 font-mono text-[11.5px] leading-5 text-ds-ink"><code>{example}</code></pre>
          <span className="absolute right-1 top-1">{copyButton('example', example, t('gatewaySetup.copyExample'))}</span>
        </div>
      </Row>
      <Row label={t('gatewaySetup.endpoints')}>
        <div className="flex flex-wrap gap-1.5">
          {ENDPOINTS.map((endpoint) => <span key={endpoint} className="rounded-md border border-ds-border-muted px-1.5 py-0.5 font-mono text-[10.5px] text-ds-muted">{endpoint}</span>)}
        </div>
      </Row>
    </div>
  </section>
}
