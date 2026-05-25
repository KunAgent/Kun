import type { ReactElement } from 'react'
import { Bot, Code2, PencilLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  activeView: 'chat' | 'write' | 'claw'
  onCodeOpen: () => void
  onWriteOpen: () => void
  onClawOpen: () => void
}

export function WorkspaceModeTabs({
  activeView,
  onCodeOpen,
  onWriteOpen,
  onClawOpen
}: Props): ReactElement {
  const { t } = useTranslation('common')

  const tabClass = (active: boolean): string =>
    `inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/35 ${
      active
        ? 'bg-white text-ds-ink shadow-[0_2px_8px_rgba(15,23,42,0.10)] ring-1 ring-ds-border-muted dark:bg-white/[0.13] dark:text-white dark:ring-white/10'
        : 'text-ds-faint hover:bg-white/45 hover:text-ds-muted dark:hover:bg-white/[0.07]'
    }`

  return (
    <div
      role="tablist"
      aria-label={`${t('code')} / ${t('write')} / ${t('claw')}`}
      className="mb-4 rounded-[12px] border border-ds-border-muted/45 bg-ds-subtle/72 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.52)] backdrop-blur dark:bg-white/[0.045] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <div className="grid h-[34px] grid-cols-3 gap-0.5">
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'chat'}
          onClick={onCodeOpen}
          className={tabClass(activeView === 'chat')}
        >
          <Code2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="truncate">{t('code')}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'write'}
          onClick={onWriteOpen}
          className={tabClass(activeView === 'write')}
        >
          <PencilLine className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="truncate">{t('write')}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeView === 'claw'}
          onClick={onClawOpen}
          className={tabClass(activeView === 'claw')}
        >
          <Bot className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          <span className="truncate">{t('claw')}</span>
        </button>
      </div>
    </div>
  )
}
