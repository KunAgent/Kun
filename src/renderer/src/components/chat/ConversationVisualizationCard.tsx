import { useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Info,
  Workflow,
  XCircle
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../../agent/types'
import {
  conversationVisualizationText,
  parseConversationVisualization,
  type ConversationVisualizationItem,
  type ConversationVisualizationTone,
  type ConversationVisualizationV1
} from '../../agent/conversation-visualization'

const toneClass: Record<ConversationVisualizationTone, string> = {
  neutral: 'border-ds-border-muted bg-ds-subtle/65 text-ds-ink',
  accent: 'border-accent/25 bg-accent-soft/65 text-ds-ink',
  success: 'border-emerald-500/25 bg-emerald-500/10 text-ds-ink',
  warning: 'border-amber-500/30 bg-amber-500/10 text-ds-ink',
  danger: 'border-rose-500/25 bg-rose-500/10 text-ds-ink'
}

const toneIconClass: Record<ConversationVisualizationTone, string> = {
  neutral: 'text-ds-muted',
  accent: 'text-accent',
  success: 'text-emerald-600 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-rose-600 dark:text-rose-300'
}

export function ConversationVisualizationCard({ block }: { block: ToolBlock }): ReactElement | null {
  const { t } = useTranslation('common')
  const visualization = useMemo(
    () => parseConversationVisualization(block.meta?.conversationVisualization),
    [block.meta?.conversationVisualization]
  )
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  if (!visualization) return null

  const count = visualization.sections.reduce((sum, section) => (
    sum + (section.kind === 'flow'
      ? section.steps.length
      : section.kind === 'card_grid'
        ? section.cards.length
        : section.lines.length)
  ), 0)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(conversationVisualizationText(visualization))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1_600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure
      data-conversation-visualization
      className="overflow-hidden rounded-[20px] border border-ds-border bg-ds-card/95 shadow-[0_16px_40px_rgba(15,23,42,0.06)] dark:shadow-[0_18px_44px_rgba(0,0,0,0.22)]"
    >
      <figcaption className="flex min-w-0 items-start gap-3 px-5 py-4">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent">
          <Workflow className="h-5 w-5" strokeWidth={1.8} aria-hidden />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="block text-[15px] font-semibold tracking-[-0.01em] text-ds-ink">
            {visualization.title}
          </span>
          <span className="mt-0.5 block text-[12.5px] leading-5 text-ds-muted">
            {expanded && visualization.description
              ? visualization.description
              : t('conversationVisualizationItemCount', { count })}
          </span>
        </button>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={copied ? t('conversationVisualizationCopied') : t('conversationVisualizationCopy')}
          onClick={() => void copy()}
        >
          {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        </button>
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          aria-label={expanded ? t('conversationVisualizationCollapse') : t('conversationVisualizationExpand')}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
        </button>
      </figcaption>
      {expanded ? (
        <div className="flex flex-col gap-5 border-t border-ds-border-muted px-5 py-5 motion-reduce:transition-none">
          {visualization.sections.map((section, index) => {
            const key = `${section.kind}-${index}`
            if (section.kind === 'flow') {
              return <FlowSection key={key} section={section} />
            }
            if (section.kind === 'card_grid') {
              const columns = section.columns === 3 ? 'lg:grid-cols-3' : section.columns === 2 ? 'sm:grid-cols-2' : ''
              return (
                <section key={key} aria-label={section.title}>
                  {section.title ? <SectionTitle>{section.title}</SectionTitle> : null}
                  <div className={`grid grid-cols-1 gap-3 ${columns}`}>
                    {section.cards.map((card) => <ItemCard key={card.id} item={card} />)}
                  </div>
                </section>
              )
            }
            return <CalloutSection key={key} section={section} />
          })}
        </div>
      ) : null}
    </figure>
  )
}

type FlowSectionValue = Extract<ConversationVisualizationV1['sections'][number], { kind: 'flow' }>

function FlowSection({ section }: { section: FlowSectionValue }): ReactElement {
  const vertical = section.direction === 'vertical'
  return (
    <section aria-label={section.title}>
      {section.title ? <SectionTitle>{section.title}</SectionTitle> : null}
      <ol className={vertical
        ? 'flex flex-col gap-2'
        : 'grid grid-cols-1 gap-2 md:grid-cols-[repeat(var(--flow-count),minmax(0,1fr))] md:items-stretch'
      } style={!vertical ? { '--flow-count': section.steps.length } as React.CSSProperties : undefined}>
        {section.steps.map((step, index) => (
          <li key={step.id} className="relative flex min-w-0 items-stretch">
            <ItemCard item={step} index={index + 1} className="w-full" />
            {!vertical && index < section.steps.length - 1 ? (
              <span className="absolute -right-2 top-1/2 z-[1] hidden -translate-y-1/2 text-ds-faint md:block" aria-hidden>→</span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

function ItemCard({
  item,
  index,
  className = ''
}: {
  item: ConversationVisualizationItem
  index?: number
  className?: string
}): ReactElement {
  const tone = item.tone ?? 'neutral'
  return (
    <div className={`rounded-[14px] border px-4 py-3 ${toneClass[tone]} ${className}`}>
      <div className="flex items-start gap-2.5">
        {index ? (
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${toneIconClass[tone]}`}>
            {index}
          </span>
        ) : <ToneIcon tone={tone} />}
        <div className="min-w-0">
          <div className="break-words text-[13.5px] font-semibold leading-5">{item.title}</div>
          {item.description ? (
            <p className="mt-1 break-words text-[12.5px] leading-5 text-ds-muted">{item.description}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CalloutSection({
  section
}: {
  section: Extract<ConversationVisualizationV1['sections'][number], { kind: 'callout' }>
}): ReactElement {
  return (
    <section className={`rounded-[14px] border px-4 py-3.5 ${toneClass[section.tone]}`} aria-label={section.title}>
      <div className="flex items-start gap-3">
        <ToneIcon tone={section.tone} />
        <div className="min-w-0">
          {section.title ? <div className="text-[13.5px] font-semibold leading-5">{section.title}</div> : null}
          <ul className={`${section.title ? 'mt-1.5' : ''} space-y-1 text-[12.5px] leading-5 text-ds-muted`}>
            {section.lines.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}

function ToneIcon({ tone }: { tone: ConversationVisualizationTone }): ReactElement {
  const className = `mt-0.5 h-4 w-4 shrink-0 ${toneIconClass[tone]}`
  if (tone === 'success') return <CheckCircle2 className={className} aria-hidden />
  if (tone === 'warning') return <AlertTriangle className={className} aria-hidden />
  if (tone === 'danger') return <XCircle className={className} aria-hidden />
  if (tone === 'accent') return <Info className={className} aria-hidden />
  return <Circle className={className} aria-hidden />
}

function SectionTitle({ children }: { children: string }): ReactElement {
  return <h4 className="mb-2.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ds-muted">{children}</h4>
}
