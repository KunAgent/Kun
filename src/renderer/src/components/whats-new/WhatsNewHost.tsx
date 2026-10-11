import { lazy, Suspense, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { loadWhatsNewContent, releaseNotesLanguage } from './whats-new-content'
import { openCurrentWhatsNew, useWhatsNewStore } from './whats-new-store'
import './whats-new.css'

const WhatsNewDialog = lazy(() => import('./WhatsNewDialog'))

/** Let the window settle before the dialog appears. */
const LAUNCH_DELAY_MS = 1_200
const HINT_DISMISS_MS = 6_000

let launchChecked = false

async function showLaunchNotice(): Promise<void> {
  const bridge = window.kunGui
  if (typeof bridge?.getReleaseNotice !== 'function') return
  const notice = await bridge.getReleaseNotice().catch(() => null)
  if (!notice) return
  const content = await loadWhatsNewContent(notice, releaseNotesLanguage(i18n.language))
  useWhatsNewStore.getState().show(content)
  // Seen as soon as it is on screen: a later crash must not replay it.
  await bridge.acknowledgeReleaseNotice?.(notice.version).catch(() => undefined)
}

/**
 * Shows the post-update "what's new" dialog once per version. It waits for
 * first-run setup to close and for the active turn to finish, so it never
 * covers the setup wizard or interrupts a running reply.
 */
export function WhatsNewHost(): ReactElement | null {
  const { t } = useTranslation('common')
  const blocked = useChatStore((state) => state.initialSetupOpen || state.busy)
  const open = useWhatsNewStore((state) => state.open)
  const content = useWhatsNewStore((state) => state.content)
  const hint = useWhatsNewStore((state) => state.hint)

  useEffect(() => {
    if (blocked || launchChecked) return
    const timer = window.setTimeout(() => {
      launchChecked = true
      void showLaunchNotice()
    }, LAUNCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [blocked])

  useEffect(() => {
    if (!hint) return
    const timer = window.setTimeout(() => useWhatsNewStore.getState().dismissHint(), HINT_DISMISS_MS)
    return () => window.clearTimeout(timer)
  }, [hint])

  return (
    <>
      {open && content ? (
        <Suspense fallback={null}>
          <WhatsNewDialog content={content} onClose={() => useWhatsNewStore.getState().close()} />
        </Suspense>
      ) : null}
      {hint && !open ? (
        <div role="status" className="kun-wn-hint" data-whats-new-hint>
          <span>{t('whatsNewHint')}</span>
          <button type="button" className="kun-wn-hint-action" data-whats-new-reopen onClick={() => void openCurrentWhatsNew()}>
            {t('whatsNewHintReopen')}
          </button>
          <button
            type="button"
            className="kun-wn-hint-close"
            aria-label={t('whatsNewClose')}
            onClick={() => useWhatsNewStore.getState().dismissHint()}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  )
}
