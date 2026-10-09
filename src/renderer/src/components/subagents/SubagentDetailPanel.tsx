import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  type KunRuntimeSettingsPatchV1,
  type KunRuntimeSettingsV1
} from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { mergeKunRuntimeSettings } from '@shared/app-settings-kun-merge'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { emitRendererSettingsChanged } from '../../lib/keyboard-shortcut-settings'
import { SubagentPanelHeader, SubagentSettingsEditor } from './SubagentSettingsEditor'
import { ConversationSubagentList } from './ConversationSubagentList'

type Props = {
  className?: string
  onCollapse: () => void
}

/**
 * Right-panel shell for the shared subagent editor. The editor itself is fully
 * controlled so Settings can reuse the same UI through SettingsView's form and
 * autosave pipeline. This shell owns only the panel-specific loading and
 * immediate persistence behavior.
 */
export function SubagentDetailPanel({ className, onCollapse }: Props): ReactElement {
  const { t } = useTranslation('common')
  const [kun, setKun] = useState<KunRuntimeSettingsV1 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  const revisionRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())

  const load = useCallback(async (): Promise<void> => {
    try {
      const settings = await rendererRuntimeClient.getSettings({ forceRefresh: true })
      if (!mountedRef.current) return
      setKun(getKunRuntimeSettings(settings))
      setError(null)
    } catch (caught) {
      if (!mountedRef.current) return
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const persistPatch = useCallback((patch: KunRuntimeSettingsPatchV1): Promise<void> => {
    const revision = ++revisionRef.current
    setKun((current) => current ? mergeKunRuntimeSettings(current, patch) : current)
    setError(null)

    const save = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const saved = await rendererRuntimeClient.setSettings({ agents: { kun: patch } })
        if (!mountedRef.current) return
        // A newer optimistic patch may already be visible. Only replace it with
        // the normalized server snapshot when this is still the newest save.
        if (revision === revisionRef.current) {
          setKun(getKunRuntimeSettings(saved))
          emitRendererSettingsChanged(saved)
        }
      })
      .catch((caught: unknown) => {
        if (!mountedRef.current || revision !== revisionRef.current) return
        setError(caught instanceof Error ? caught.message : String(caught))
        void load()
      })
    saveQueueRef.current = save
    return save
  }, [load])

  return (
    <div className={`ds-no-drag flex h-full min-h-0 flex-col overflow-hidden bg-ds-sidebar ${className ?? ''}`}>
      <SubagentPanelHeader onCollapse={onCollapse} />
      <ConversationSubagentList />
      {error ? (
        <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-red-300/70 bg-red-50 px-3 py-2 text-[12px] leading-5 text-red-800 dark:border-red-700/60 dark:bg-red-950/30 dark:text-red-200">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-md border border-current/25 px-2 py-0.5 font-semibold hover:bg-red-100 dark:hover:bg-red-900/30"
          >
            {t('retry', 'Retry')}
          </button>
        </div>
      ) : null}
      {kun ? (
        <SubagentSettingsEditor
          kun={kun}
          onPatch={persistPatch}
          variant="panel"
          className="min-h-0 flex-1"
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-ds-muted">{t('loading', 'Loading')}</div>
      )}
    </div>
  )
}
