import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppSandboxInstanceInfo } from '@shared/app-sandbox'
import { appSandboxApi, resolveAppSandboxTheme } from '../app-sandbox-client'
import { AppSandboxFrame, useDocumentThemeMode, type AppSandboxFrameStatus } from '../AppSandboxFrame'
import { attachGenUiPageHost } from './gen-ui-page-host'

const INITIAL_HEIGHT = 240

/** One live Gen UI page; `fill` stretches it to its container (App panel). */
export function GenUiSurface({
  threadId,
  widgetId,
  title,
  fill = false,
  onInstance
}: {
  threadId: string
  widgetId: string
  title: string
  fill?: boolean
  onInstance?: (instance: AppSandboxInstanceInfo | null) => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const themeMode = useDocumentThemeMode()
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(INITIAL_HEIGHT)
  const [instance, setInstance] = useState<AppSandboxInstanceInfo | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const onInstanceRef = useRef(onInstance)
  onInstanceRef.current = onInstance
  const titleRef = useRef(title)
  titleRef.current = title

  const create = useCallback(() => {
    const api = appSandboxApi()
    if (!api) return Promise.resolve({ ok: false as const, code: 'UNAVAILABLE', message: t('appSurfaceDesktopOnly') })
    return api.createGenUi({
      threadId,
      widgetId,
      theme: resolveAppSandboxTheme(anchorRef.current, i18n.language)
    })
  }, [i18n.language, t, threadId, widgetId])

  const onStatus = useCallback((status: AppSandboxFrameStatus) => {
    const next = status.kind === 'ready' ? status.instance : null
    setInstance(next)
    onInstanceRef.current?.(next)
    if (status.kind !== 'ready') setPageError(null)
  }, [])

  useEffect(() => {
    if (!instance) return
    return attachGenUiPageHost({
      instanceId: instance.instanceId,
      threadId,
      widgetId,
      title: titleRef.current,
      onHeight: setHeight,
      onPageError: setPageError
    })
  }, [instance, threadId, widgetId])

  return (
    <div ref={anchorRef} className={fill ? 'flex h-full min-h-0 flex-col' : 'relative'}>
      <AppSandboxFrame
        create={create}
        generation={`${widgetId}:${themeMode}`}
        height={fill ? '100%' : height}
        className={fill ? 'min-h-0 flex-1' : ''}
        title={title}
        onStatus={onStatus}
        renderFailure={(message, retry) => (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-ds-border-muted bg-ds-subtle px-3 py-2 text-[12px] text-ds-muted">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{message}</span>
            <button type="button" onClick={retry} className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-ds-ink hover:bg-ds-hover">
              <RotateCw className="h-3 w-3" aria-hidden />
              {t('appSurfaceRetry')}
            </button>
          </div>
        )}
      />
      {pageError ? (
        <div className="mt-1 truncate text-[11px] text-amber-600 dark:text-amber-300" title={pageError}>
          {t('appSurfacePageError', { message: pageError })}
        </div>
      ) : null}
    </div>
  )
}
