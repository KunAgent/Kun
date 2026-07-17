import type { ReactElement } from 'react'
import { Code2, Palette, PencilLine, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  activeView: 'chat' | 'write' | 'design' | 'collaboration' | 'claw' | 'schedule' | 'workflow' | 'subagents'
  onCodeOpen: () => void
  onWriteOpen: () => void
  onDesignOpen: () => void
  onCollaborationOpen: () => void
}

export function WorkspaceModeTabs({
  activeView,
  onCodeOpen,
  onWriteOpen,
  onDesignOpen,
  onCollaborationOpen
}: Props): ReactElement {
  const { t } = useTranslation('common')

  const tabClass = (active: boolean): string =>
    `workspace-mode-tab group inline-flex min-h-[28px] flex-1 min-w-0 items-center justify-center gap-1.5 rounded-[6px] px-2 py-0.5 text-[13px] outline-none transition-[background-color,color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-black/10 dark:focus-visible:ring-white/20 ${
      active
        ? 'bg-white font-medium text-[#1f2733] shadow-[0_1px_2px_rgba(20,47,95,0.12),0_2px_5px_rgba(20,47,95,0.06)] dark:bg-white/[0.12] dark:text-white dark:shadow-[0_1px_2px_rgba(0,0,0,0.35)]'
        : 'font-normal text-[#646e7c] hover:text-[#1f2733] dark:text-white/55 dark:hover:text-white/90'
    }`

  const iconClass = (active: boolean): string =>
    `h-[15px] w-[15px] shrink-0 transition-colors ${
      active
        ? 'text-[#1f2733] dark:text-white'
        : 'text-[#8b95a3] group-hover:text-[#1f2733] dark:text-white/45 dark:group-hover:text-white/85'
    }`

  return (
    <div
      role="tablist"
      aria-label={`${t('code')} / ${t('write')} / ${t('design')} / ${t('collaboration')}`}
      className="workspace-mode-tabs mb-1.5 flex flex-row gap-1 rounded-[8px] bg-[color-mix(in_srgb,var(--ds-sidebar-field-bg)_72%,transparent)] p-0.5 shadow-[inset_0_0_0_1px_var(--ds-sidebar-row-ring)] dark:bg-white/[0.045] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
    >
      <button
        type="button"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'chat'}
        onClick={onCodeOpen}
        className={tabClass(activeView === 'chat')}
        title={t('code')}
      >
        <Code2 className={iconClass(activeView === 'chat')} strokeWidth={1.9} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('code')}</span>
      </button>
      <button
        type="button"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'write'}
        onClick={onWriteOpen}
        className={tabClass(activeView === 'write')}
        title={t('write')}
      >
        <PencilLine className={iconClass(activeView === 'write')} strokeWidth={1.9} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('write')}</span>
      </button>
      <button
        type="button"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'design'}
        onClick={onDesignOpen}
        className={tabClass(activeView === 'design')}
        title={t('design')}
      >
        <Palette className={iconClass(activeView === 'design')} strokeWidth={1.9} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('design')}</span>
      </button>
      <button
        type="button"
        data-cursor-spotlight-target
        role="tab"
        aria-selected={activeView === 'collaboration'}
        onClick={onCollaborationOpen}
        className={tabClass(activeView === 'collaboration')}
        title={t('collaboration')}
      >
        <UsersRound className={iconClass(activeView === 'collaboration')} strokeWidth={1.9} />
        <span className="workspace-mode-tab-label whitespace-nowrap">{t('collaboration')}</span>
      </button>
    </div>
  )
}
