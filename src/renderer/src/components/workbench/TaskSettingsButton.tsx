import { lazy, Suspense, useState, type ReactElement } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { HEADER_ICON_BUTTON_CLASS, HEADER_ICON_CLASS, HEADER_ICON_STROKE } from './header-action-button'

const TaskSettingsDrawer = lazy(() => import('./TaskSettingsDrawer').then((module) => ({ default: module.TaskSettingsDrawer })))

export function TaskSettingsButton({ thread }: { thread: NormalizedThread }): ReactElement | null {
  const { t } = useTranslation('common')
  const route = useChatStore((state) => state.route)
  const [open, setOpen] = useState(false)
  if (route !== 'chat' && route !== 'ade') return null
  return <>
    <button type="button" onClick={() => setOpen(true)} data-tooltip={t('taskSettings.title')} aria-label={t('taskSettings.title')}
      className={`ds-no-drag ${HEADER_ICON_BUTTON_CLASS}`}>
      <Settings2 className={HEADER_ICON_CLASS} strokeWidth={HEADER_ICON_STROKE} />
    </button>
    {open ? <Suspense fallback={null}><TaskSettingsDrawer thread={thread} onClose={() => setOpen(false)} /></Suspense> : null}
  </>
}
