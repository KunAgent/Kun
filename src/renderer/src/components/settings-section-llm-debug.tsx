import { settingsButtonClass } from './settings-button'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  ExternalLink,
  History,
  RefreshCw,
  SlidersHorizontal,
  X
} from 'lucide-react'
import type { KunRuntimeSettingsPatchV1, KunRuntimeSettingsV1 } from '@shared/app-settings'
import {
  SettingsCard,
  SettingsTabPanel,
  SettingsTabs,
  SettingRow,
  Toggle
} from './settings-controls'

export type LlmDebugToolCall = {
  callId: string
  toolName: string
  arguments: Record<string, unknown>
}

export type LlmDebugRound = {
  id: number
  threadId: string
  turnId: string
  provider: string
  model: string
  url: string
  startedAt: string
  finishedAt: string
  durationMs: number
  requestBody: Record<string, unknown> | null
  output: {
    text: string
    reasoning: string
    toolCalls: LlmDebugToolCall[]
    usage?: Record<string, unknown>
    stopReason?: string
    error?: string
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string
type DetailTab = 'overview' | 'request' | 'response'
type LlmDebugPageTab = 'capture' | 'records'

const PAGE_SIZE = 5
const detailTabs: DetailTab[] = ['overview', 'request', 'response']
const panelClass =
  'flex min-h-[560px] min-w-0 flex-col overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/90 shadow-[0_18px_48px_-34px_rgba(37,69,130,0.45)] backdrop-blur-xl dark:shadow-black/30 xl:min-h-[640px]'
const codeClass =
  'min-h-0 flex-1 overflow-auto rounded-2xl border border-white/5 bg-[#101a2d] p-4 font-mono text-[11.5px] leading-5 text-slate-200 shadow-inner shadow-black/20'

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function timestampValue(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export function sortLlmDebugRoundsNewestFirst(rounds: LlmDebugRound[]): LlmDebugRound[] {
  return [...rounds].sort((a, b) => {
    const timeDifference = timestampValue(b.startedAt) - timestampValue(a.startedAt)
    return timeDifference || b.id - a.id
  })
}

export function paginateLlmDebugRounds(
  rounds: LlmDebugRound[],
  page: number
): LlmDebugRound[] {
  const start = Math.max(0, page) * PAGE_SIZE
  return rounds.slice(start, start + PAGE_SIZE)
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1_000) {
    const seconds = durationMs / 1_000
    return `${seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)}s`
  }
  return `${durationMs}ms`
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function roundStatus(round: LlmDebugRound, t: Translate): {
  label: string
  className: string
} {
  if (round.output.error) {
    return {
      label: t('llmDebugStatusError'),
      className: 'bg-red-500/10 text-red-700 dark:text-red-300'
    }
  }
  if (round.output.toolCalls.length > 0 || round.output.stopReason === 'tool_calls') {
    return {
      label: t('llmDebugStatusToolCalls'),
      className: 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
    }
  }
  return {
    label: t('llmDebugStatusCompleted'),
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }
}

function RequestRow({
  round,
  selected,
  expanded,
  t,
  onToggle,
  onOpenDetail
}: {
  round: LlmDebugRound
  selected: boolean
  expanded: boolean
  t: Translate
  onToggle: () => void
  onOpenDetail: () => void
}): ReactElement {
  const status = roundStatus(round, t)
  const stopReason = round.output.error || round.output.stopReason || '—'

  return (
    <article
      data-llm-debug-round={round.id}
      className={`overflow-hidden rounded-2xl border transition ${
        selected
          ? 'border-accent/55 bg-accent/[0.045] shadow-[0_0_0_1px_rgba(59,130,246,0.08),0_14px_34px_-26px_rgba(59,130,246,0.9)]'
          : 'border-ds-border-muted bg-ds-main/45 hover:border-ds-border hover:bg-ds-hover/45'
      }`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left"
      >
        <span className="font-mono text-[12px] font-semibold text-accent">#{round.id}</span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="truncate text-[13px] font-semibold text-ds-ink">{round.model}</span>
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10.5px] font-medium ${status.className}`}>
              {status.label}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-ds-faint">
            <span className="font-mono">{formatTimestamp(round.startedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{formatDuration(round.durationMs)}</span>
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ds-faint transition-transform ${expanded ? 'rotate-180 text-accent' : ''}`}
          strokeWidth={1.8}
        />
      </button>

      {expanded ? (
        <div className="border-t border-ds-border-muted px-4 pb-4 pt-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[11px]">
            <div className="min-w-0">
              <dt className="text-ds-faint">{t('llmDebugEndpoint')}</dt>
              <dd className="mt-1 truncate font-mono text-ds-muted" title={round.url}>{round.url}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ds-faint">{t('llmDebugProvider')}</dt>
              <dd className="mt-1 truncate font-mono text-ds-muted">{round.provider}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ds-faint">{t('llmDebugStopReason')}</dt>
              <dd className={`mt-1 truncate font-mono ${round.output.error ? 'text-ds-danger' : 'text-ds-muted'}`}>
                {stopReason}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-ds-faint">{t('llmDebugDuration')}</dt>
              <dd className="mt-1 font-mono text-ds-muted">{formatDuration(round.durationMs)}</dd>
            </div>
          </dl>
          <div className="mt-3 flex justify-end">
            <button className={settingsButtonClass()}
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onOpenDetail()
              }}
            >
              {t('llmDebugViewDetails')}
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
        </div>
      ) : null}
    </article>
  )
}

function MetadataStrip({ round, t }: { round: LlmDebugRound; t: Translate }): ReactElement {
  const status = roundStatus(round, t)
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ds-border-muted bg-ds-border-muted md:grid-cols-4">
      {[
        [t('llmDebugModel'), round.model],
        [t('llmDebugDuration'), formatDuration(round.durationMs)],
        [t('llmDebugStatus'), status.label],
        [t('llmDebugTime'), formatTimestamp(round.startedAt)]
      ].map(([label, value]) => (
        <div key={label} className="min-w-0 bg-ds-main/55 px-3 py-2.5">
          <dt className="text-[10.5px] text-ds-faint">{label}</dt>
          <dd className="mt-1 truncate font-mono text-[11.5px] font-medium text-ds-ink" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function OverviewPanel({ round, t }: { round: LlmDebugRound; t: Translate }): ReactElement {
  const output = round.output
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-ds-border-muted bg-ds-main/45 p-4">
          <div className="text-[11px] text-ds-faint">{t('llmDebugEndpoint')}</div>
          <div className="mt-1.5 break-all font-mono text-[11.5px] leading-5 text-ds-ink">{round.url}</div>
        </div>
        <div className="rounded-2xl border border-ds-border-muted bg-ds-main/45 p-4">
          <div className="text-[11px] text-ds-faint">{t('llmDebugRequestContext')}</div>
          <div className="mt-1.5 space-y-1 font-mono text-[11.5px] leading-5 text-ds-ink">
            <div>{round.provider}</div>
            <div className="truncate text-ds-faint" title={round.turnId}>{round.turnId}</div>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-ds-border-muted bg-ds-main/45 p-4">
        <div className="text-[11px] font-semibold text-ds-muted">{t('llmDebugOutputSummary')}</div>
        {output.error ? <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-ds-danger">{output.error}</p> : null}
        {output.text ? <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5 text-ds-ink">{output.text}</p> : null}
        {output.reasoning ? (
          <div className="mt-3 border-t border-ds-border-muted pt-3">
            <div className="text-[10.5px] text-ds-faint">{t('llmDebugReasoning')}</div>
            <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-[11.5px] leading-5 text-ds-muted">
              {output.reasoning}
            </p>
          </div>
        ) : null}
        {!output.text && !output.reasoning && !output.error ? (
          <p className="mt-2 text-[12px] text-ds-faint">—</p>
        ) : null}
      </div>
    </div>
  )
}

function DetailPanel({
  round,
  activeTab,
  copied,
  t,
  onTabChange,
  onCopy,
  onClose
}: {
  round: LlmDebugRound | null
  activeTab: DetailTab
  copied: boolean
  t: Translate
  onTabChange: (tab: DetailTab) => void
  onCopy: () => void
  onClose: () => void
}): ReactElement {
  if (!round) {
    return (
      <section className={panelClass} data-llm-debug-detail>
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/15 bg-accent/[0.06] text-accent">
              <ExternalLink className="h-5 w-5" strokeWidth={1.6} />
            </div>
            <p className="mt-3 text-[13px] font-medium text-ds-ink">{t('llmDebugSelectRequest')}</p>
            <p className="mt-1 text-[11.5px] text-ds-faint">{t('llmDebugSelectRequestDesc')}</p>
          </div>
        </div>
      </section>
    )
  }

  const tabLabel: Record<DetailTab, string> = {
    overview: t('llmDebugOverview'),
    request: t('llmDebugRequestBody'),
    response: t('llmDebugRawResponse')
  }
  const response = pretty(round.output)

  return (
    <section className={panelClass} data-llm-debug-detail={round.id}>
      <header className="flex items-center justify-between gap-3 border-b border-ds-border-muted px-5 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="truncate text-[15px] font-semibold text-ds-ink">{t('llmDebugDetails')}</h2>
          <span className="rounded-md border border-accent/15 bg-accent/[0.07] px-2 py-0.5 font-mono text-[10.5px] font-semibold text-accent">
            #{round.id}
          </span>
        </div>
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
        >
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-3">
        <div className="flex gap-5 border-b border-ds-border-muted" role="tablist">
          {detailTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
              className={`relative px-1 pb-2.5 text-[12px] font-medium transition ${
                activeTab === tab ? 'text-accent' : 'text-ds-faint hover:text-ds-ink'
              }`}
            >
              {tabLabel[tab]}
              {activeTab === tab ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" /> : null}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <MetadataStrip round={round} t={t} />
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col">
          {activeTab === 'overview' ? <OverviewPanel round={round} t={t} /> : null}
          {activeTab === 'request' ? (
            <pre className={codeClass}>{round.requestBody ? pretty(round.requestBody) : '—'}</pre>
          ) : null}
          {activeTab === 'response' ? <pre className={codeClass}>{response}</pre> : null}
        </div>
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-ds-border-muted px-5 py-3.5">
        <span>
          {activeTab === 'request' ? (
            <button className={settingsButtonClass()}
              type="button"
              onClick={onCopy}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? t('llmDebugCopied') : t('llmDebugCopyJson')}
            </button>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          className={settingsButtonClass({ variant: 'primary' })}
        >
          {t('done')}
        </button>
      </footer>
    </section>
  )
}

export function LlmDebugRequestBrowser({
  rounds,
  t
}: {
  rounds: LlmDebugRound[]
  t: Translate
}): ReactElement {
  const sortedRounds = useMemo(() => sortLlmDebugRoundsNewestFirst(rounds), [rounds])
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(() => sortedRounds[0]?.id ?? null)
  const [expandedId, setExpandedId] = useState<number | null>(() => sortedRounds[0]?.id ?? null)
  const [activeTab, setActiveTab] = useState<DetailTab>('request')
  const [copied, setCopied] = useState(false)
  const pageCount = Math.max(1, Math.ceil(sortedRounds.length / PAGE_SIZE))
  const visibleRounds = paginateLlmDebugRounds(sortedRounds, page)
  const selectedRound = sortedRounds.find((round) => round.id === selectedId) ?? null

  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(sortedRounds.length / PAGE_SIZE) - 1)
    setPage((current) => Math.min(current, lastPage))
    setSelectedId((current) => (
      current !== null && sortedRounds.some((round) => round.id === current)
        ? current
        : (sortedRounds[0]?.id ?? null)
    ))
    setExpandedId((current) => (
      current !== null && sortedRounds.some((round) => round.id === current)
        ? current
        : (sortedRounds[0]?.id ?? null)
    ))
  }, [sortedRounds])

  const changePage = (nextPage: number): void => {
    const clamped = Math.min(Math.max(nextPage, 0), pageCount - 1)
    const firstRound = paginateLlmDebugRounds(sortedRounds, clamped)[0]
    setPage(clamped)
    setSelectedId(firstRound?.id ?? null)
    setExpandedId(firstRound?.id ?? null)
    setActiveTab('request')
    setCopied(false)
  }

  const copyRequestBody = async (): Promise<void> => {
    if (!selectedRound?.requestBody || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(pretty(selectedRound.requestBody))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const pageStart = page * PAGE_SIZE + 1
  const pageEnd = Math.min((page + 1) * PAGE_SIZE, sortedRounds.length)

  return (
    <div className="grid min-w-0 items-stretch gap-4 xl:grid-cols-[minmax(360px,0.9fr)_minmax(440px,1.1fr)]">
      <section className={panelClass} data-llm-debug-list>
        <header className="border-b border-ds-border-muted px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ds-ink">{t('llmDebugRecords')}</h2>
              <p className="mt-1 text-[11.5px] text-ds-faint">
                {t('llmDebugRecordCount', { count: sortedRounds.length, pageSize: PAGE_SIZE })}
              </p>
            </div>
            <span className="rounded-lg border border-accent/15 bg-accent/[0.06] px-2.5 py-1 text-[10.5px] font-medium text-accent">
              {t('llmDebugNewestFirst')}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
          {visibleRounds.map((round) => (
            <RequestRow
              key={round.id}
              round={round}
              selected={selectedId === round.id}
              expanded={expandedId === round.id}
              t={t}
              onToggle={() => {
                setSelectedId(round.id)
                setExpandedId((current) => current === round.id ? null : round.id)
                setCopied(false)
              }}
              onOpenDetail={() => {
                setSelectedId(round.id)
                setActiveTab('request')
                setCopied(false)
              }}
            />
          ))}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ds-border-muted px-4 py-3.5">
          <span className="font-mono text-[10.5px] text-ds-faint">
            {t('llmDebugPageRange', { start: pageStart, end: pageEnd, count: sortedRounds.length })}
          </span>
          <nav className="flex items-center gap-1.5" aria-label={t('llmDebugPagination')}>
            <button
              type="button"
              aria-label={t('previousPage')}
              disabled={page === 0}
              onClick={() => changePage(page - 1)}
              className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            {Array.from({ length: pageCount }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={t('llmDebugPageNumber', { page: index + 1 })}
                aria-current={page === index ? 'page' : undefined}
                onClick={() => changePage(index)}
                className={`h-7 min-w-7 rounded-lg px-1.5 font-mono text-[10.5px] font-semibold transition ${
                  page === index
                    ? 'bg-accent text-white shadow-sm shadow-accent/25'
                    : 'border border-ds-border text-ds-muted hover:border-accent/25 hover:text-accent'
                }`}
              >
                {index + 1}
              </button>
            ))}
            <button
              type="button"
              aria-label={t('nextPage')}
              disabled={page === pageCount - 1}
              onClick={() => changePage(page + 1)}
              className={settingsButtonClass({ variant: 'ghost', size: 'icon' })}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </nav>
        </footer>
      </section>

      <DetailPanel
        round={selectedRound}
        activeTab={activeTab}
        copied={copied}
        t={t}
        onTabChange={(tab) => {
          setActiveTab(tab)
          setCopied(false)
        }}
        onCopy={() => void copyRequestBody()}
        onClose={() => {
          setSelectedId(null)
          setCopied(false)
        }}
      />
    </div>
  )
}

export function LlmDebugSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, kun, updateKun } = ctx as {
    t: Translate
    kun: KunRuntimeSettingsV1
    updateKun: (patch: KunRuntimeSettingsPatchV1) => void
  }
  const [rounds, setRounds] = useState<LlmDebugRound[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activePageTab, setActivePageTab] = useState<LlmDebugPageTab>('capture')
  const pageTabs = [
    { id: 'capture', label: t('llmDebugCaptureSettings'), icon: SlidersHorizontal },
    { id: 'records', label: t('llmDebugRecords'), icon: History }
  ] as const

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.kunGui.runtimeRequest('/v1/debug/llm-rounds', 'GET')
      if (!result.ok) {
        setError(`HTTP ${result.status}`)
        return
      }
      const parsed = JSON.parse(result.body) as { rounds?: LlmDebugRound[] }
      setRounds(parsed.rounds ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <SettingsTabs
        baseId="llm-debug-settings"
        ariaLabel={t('sectionLlmDebug')}
        items={pageTabs}
        value={activePageTab}
        onChange={setActivePageTab}
      />

      <SettingsTabPanel
        baseId="llm-debug-settings"
        tabId="capture"
        active={activePageTab === 'capture'}
        className="space-y-4"
      >
        <SettingsCard
          title={t('llmDebugCaptureSettings')}
          description={t('llmDebugCaptureSettingsDesc')}
        >
          <SettingRow
            title={t('llmDebugDefaultCapture')}
            description={t('llmDebugDefaultCaptureDesc')}
            control={
              <Toggle
                checked={kun.llmDebug.defaultThreadCaptureEnabled}
                onChange={(defaultThreadCaptureEnabled) =>
                  updateKun({ llmDebug: { defaultThreadCaptureEnabled } })}
                ariaLabel={t('llmDebugDefaultCapture')}
              />
            }
          />
        </SettingsCard>
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="llm-debug-settings"
        tabId="records"
        active={activePageTab === 'records'}
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ds-border-muted bg-ds-card/55 px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ds-ink">{t('sectionLlmDebug')}</h2>
            <p className="mt-0.5 text-[11.5px] leading-5 text-ds-faint">{t('llmDebugDesc')}</p>
          </div>
          <button aria-busy={Boolean(loading)}
            type="button"
            aria-label={t('refresh')}
            title={t('refresh')}
            disabled={loading}
            onClick={() => void load()}
              className={settingsButtonClass({ variant: 'ghost', size: 'icon', className: 'shrink-0' })}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.8} />
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-[12px] text-ds-danger">
            {error}
          </p>
        ) : null}

        {rounds.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-ds-border bg-ds-card/55 px-6 py-16 text-center">
            <p className="text-[12.5px] text-ds-faint">{loading ? t('loading') : t('llmDebugEmpty')}</p>
          </div>
        ) : (
          <LlmDebugRequestBrowser rounds={rounds} t={t} />
        )}
      </SettingsTabPanel>
    </div>
  )
}
