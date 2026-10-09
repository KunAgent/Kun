import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerUpLeft, Lock } from 'lucide-react'

/**
 * Replaces the composer while viewing an external Agent's subagent: the side
 * thread mirrors steps the Agent ran on its own, so it is read-only here and
 * follow-ups go through the main conversation.
 */
export function ExternalSubagentReturnBar({
  parentTitle,
  onBack,
  agentName
}: {
  parentTitle: string
  onBack: () => void
  agentName: string
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div
      data-testid="subagent-return-bar"
      data-variant="external"
      className="ds-chat-content-max-width flex w-full items-center gap-3 rounded-[16px] border border-accent/16 bg-accent/7 px-4 py-3 text-ds-muted shadow-[0_14px_36px_rgba(59,130,216,0.05)]"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-accent/12 text-accent">
        <Lock className="h-4 w-4" strokeWidth={1.85} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ds-ink">
          {t('externalSubagentBannerTitle', { agent: agentName, defaultValue: 'Viewing a {{agent}} subagent' })}
        </span>
        <span className="mt-1 block truncate text-[12.5px] leading-5 text-ds-muted">
          {parentTitle
            ? t('externalSubagentBannerSub', {
              agent: agentName,
              title: parentTitle,
              defaultValue: 'Delegated by {{agent}} in “{{title}}”. Read only: ask follow-ups in the main chat.'
            })
            : t('externalSubagentBannerSubUnknown', {
              agent: agentName,
              defaultValue: 'Run by {{agent}}. Read only: ask follow-ups in the main chat.'
            })}
        </span>
      </span>
      <button
        type="button"
        onClick={onBack}
        className="flex shrink-0 items-center gap-1.5 rounded-[10px] bg-accent/10 px-2.5 py-1.5 text-[12px] font-semibold text-accent transition hover:bg-accent/15"
      >
        <CornerUpLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
        {t('subagentSessionBannerBack')}
      </button>
    </div>
  )
}
