import { useState, type ReactElement } from 'react'
import { Check, ImageDown, Maximize2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSandboxInstanceInfo } from '@shared/app-sandbox'
import type { GenUiWidgetRef } from '../../../../../kun/src/contracts/gen-ui'
import { appSandboxApi } from '../app-sandbox-client'
import { useAppSurfaceStore } from '../app-surface-store'
import { GenUiSurface } from './GenUiSurface'

export function GenUiCard({
  threadId,
  widget
}: {
  threadId: string
  widget: GenUiWidgetRef
}): ReactElement {
  const { t } = useTranslation('common')
  const openPanel = useAppSurfaceStore((state) => state.openPanel)
  const [instance, setInstance] = useState<AppSandboxInstanceInfo | null>(null)
  const [copied, setCopied] = useState(false)

  const copyImage = async (): Promise<void> => {
    if (!instance) return
    const result = await appSandboxApi()?.capture(instance.instanceId)
    if (!result) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_600)
  }

  return (
    <section
      className={`group/gen-ui my-2 ${widget.mode === 'wide' ? 'w-full' : 'w-full max-w-full'}`}
      aria-label={t('appSurfaceWidgetAria', { title: widget.title })}
      data-gen-ui-widget={widget.widgetId}
    >
      <header className="mb-1 flex items-center gap-1.5 text-[12px] text-ds-muted">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-ds-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-ds-ink">{widget.title}</span>
        <div className="flex items-center gap-0.5 opacity-0 transition group-hover/gen-ui:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            disabled={!instance}
            onClick={() => void copyImage()}
            className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40"
            aria-label={copied ? t('appSurfaceCopied') : t('appSurfaceCopyImage')}
            title={copied ? t('appSurfaceCopied') : t('appSurfaceCopyImage')}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ImageDown className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => openPanel({
              kind: 'gen-ui',
              key: `gen-ui:${threadId}:${widget.widgetId}`,
              threadId,
              widgetId: widget.widgetId,
              title: widget.title
            })}
            className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
            aria-label={t('appSurfaceExpand')}
            title={t('appSurfaceExpand')}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      <GenUiSurface threadId={threadId} widgetId={widget.widgetId} title={widget.title} onInstance={setInstance} />
    </section>
  )
}
