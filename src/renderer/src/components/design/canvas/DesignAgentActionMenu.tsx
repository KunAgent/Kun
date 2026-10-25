import { type ReactElement } from 'react'
import { WandSparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesignAgentAction } from '../../../design/agent-actions/design-agent-actions'
import { CANVAS_CHROME_MENU } from './chrome/canvas-chrome-primitives'

type Props = {
  open: boolean
  actions: readonly DesignAgentAction[]
  buttonClassName: string
  onToggle: () => void
  onSelect: (action: DesignAgentAction) => void
}

export function DesignAgentActionMenu({
  open,
  actions,
  buttonClassName,
  onToggle,
  onSelect
}: Props): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="relative">
      <button
        type="button"
        className={buttonClassName}
        onClick={onToggle}
        title={t('designAgentActions')}
        aria-label={t('designAgentActions')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <WandSparkles className="h-4 w-4" strokeWidth={1.9} />
      </button>
      {open ? (
        <div role="menu" className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 w-72`}>
          {actions.map((action) => {
            const disabled = Boolean(action.disabledReasonKey)
            const title = action.disabledReasonKey ? t(action.disabledReasonKey) : t(action.detailKey)
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={disabled}
                title={title}
                onClick={() => onSelect(action)}
                className="flex w-full items-start gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t(action.labelKey)}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ds-faint">
                    {t(action.detailKey)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
