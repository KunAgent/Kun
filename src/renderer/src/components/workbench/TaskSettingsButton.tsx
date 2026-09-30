import { lazy, Suspense, useState, type ReactElement } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { NormalizedThread } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'

const TaskSettingsDrawer = lazy(() => import('./TaskSettingsDrawer').then((module) => ({ default: module.TaskSettingsDrawer })))

export function TaskSettingsButton({ thread }: { thread: NormalizedThread }): ReactElement | null {
  const { t } = useTranslation('common')
  const route = useChatStore((state) => state.route)
  const [open, setOpen] = useState(false)
  if (route !== 'chat' && route !== 'ade') return null
  return <>
    <button type="button" onClick={() => setOpen(true)} title={t('taskSettings.title')} aria-label={t('taskSettings.title')}
      className="ds-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ds-faint hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30">
      <Settings2 className="h-4 w-4" strokeWidth={1.8} />
    </button>
    {open ? <Suspense fallback={null}><TaskSettingsDrawer thread={thread} onClose={() => setOpen(false)} /></Suspense> : null}
  </>
}
