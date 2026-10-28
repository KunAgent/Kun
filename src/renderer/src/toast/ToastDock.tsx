import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ToastCard } from './ToastCard'
import { useToastStore } from './toast-store'

/**
 * The single place notifications appear: one dock in the bottom-right corner
 * of every surface. Cards are ordered oldest to newest, at most
 * `TOAST_MAX_VISIBLE` are shown, and important ones that do not fit wait for
 * a slot instead of being dropped. It stacks above the floating previews that
 * share this corner (z-80) and below dialogs, which stay in front.
 */
export function ToastDock(): ReactElement | null {
  const { t } = useTranslation('common')
  const items = useToastStore((state) => state.items)
  const waitingItems = useToastStore((state) => state.waitingItems)
  if (!items.length) return null
  return (
    <section
      aria-label={t('toastRegion')}
      data-toast-dock
      data-toast-visible={items.length}
      data-toast-waiting={waitingItems.length}
      className="ds-no-drag pointer-events-none fixed bottom-6 right-6 z-[85] flex w-[min(368px,calc(100vw-2rem))] flex-col gap-2"
    >
      {items.map((item) => <ToastCard key={item.id} item={item} />)}
      {waitingItems.length > 0 ? (
        <p className="pointer-events-auto self-end rounded-md border border-ds-border-muted bg-ds-card px-2 py-0.5 text-[11px] text-ds-muted shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
          {t('toastWaiting', { hidden: waitingItems.length })}
        </p>
      ) : null}
    </section>
  )
}
