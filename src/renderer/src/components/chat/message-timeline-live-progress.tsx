import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleHelp } from 'lucide-react'
import type { ChatBlock } from '../../agent/types'
import {
  AnimatedWorkLogo,
  IKUN_WORK_LOGO_VARIANT_LABEL_KEYS,
  WORK_LOGO_SWIM_MODE_LABEL_KEYS,
  useIkunWorkLogoVariant,
  useWorkLogoSwimMode,
  type IkunWorkLogoVariant,
  type WorkLogoSwimMode
} from './AnimatedWorkLogo'
import type { UiPluginLabelKey } from '@shared/ui-plugin'
import { useUiPluginWorkLabel } from '../../store/ui-plugin-store'
import { summarizeToolBlock } from './message-timeline-process'
import { liveTurnProgressClass } from './message-timeline-jump-preview'
import { formatDuration } from './message-timeline-tools'
import { LiveElapsedText } from './LiveElapsedText'

/**
 * The live "working" row under the active turn. The elapsed suffix is a
 * DOM-ticking `LiveElapsedText` sibling (not part of the translated label) so
 * the shimmer style can apply to each piece without nested-span inheritance
 * issues and the parent turn never re-renders on the timer.
 */
export function LiveTurnProgressRow({
  tool,
  thinking,
  activityLabel,
  awaitingUserInput = false,
  durationMs,
  liveStartedAtMs
}: {
  tool?: Extract<ChatBlock, { kind: 'tool' }>
  thinking: boolean
  activityLabel?: string
  awaitingUserInput?: boolean
  durationMs?: number
  liveStartedAtMs?: number
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const swimMode = useWorkLogoSwimMode(true)
  const ikunVariant = useIkunWorkLogoVariant(true)
  // iKun 模式是全局 html 属性;进行行每个回合重新挂载,挂载时读取即可
  const [ikunModeOn] = useState(
    () =>
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-ikun-mode') === 'on'
  )
  const swimLabelKey = WORK_LOGO_SWIM_MODE_LABEL_KEYS[swimMode]
  // UI 插件可声明自己的进行中文案(按泳姿键、按语言),未声明则用默认文案
  const pluginLabel = useUiPluginWorkLabel(
    swimLabelKey as UiPluginLabelKey,
    i18n.language ?? 'zh'
  )
  const activityText = awaitingUserInput
    ? t('awaitingYourInput')
    : activityLabel
    ? t('workingToolAction', { action: activityLabel })
    : thinking
      ? t('thinkingNow')
      : tool
        ? t('workingToolAction', { action: summarizeToolBlock(tool, t) })
        : ikunModeOn
          ? t(IKUN_WORK_LOGO_VARIANT_LABEL_KEYS[ikunVariant])
          : pluginLabel ?? t(swimLabelKey)
  const hasElapsed = typeof liveStartedAtMs === 'number'
  const label = typeof durationMs === 'number' && !hasElapsed
    ? `${activityText} · ${formatDuration(durationMs)}`
    : activityText

  return (
    <LiveTurnActivityRow
      label={label}
      liveStartedAtMs={liveStartedAtMs}
      ikunVariant={ikunVariant}
      swimMode={swimMode}
      awaitingUserInput={awaitingUserInput}
    />
  )
}

function LiveTurnActivityRow({
  label,
  liveStartedAtMs,
  ikunVariant,
  swimMode,
  awaitingUserInput = false
}: {
  label: string
  liveStartedAtMs?: number
  ikunVariant?: IkunWorkLogoVariant
  swimMode?: WorkLogoSwimMode
  awaitingUserInput?: boolean
}): ReactElement {
  return (
    <div className={liveTurnProgressClass()} data-turn-live-status-owner="generic">
      {awaitingUserInput ? (
        <CircleHelp
          className="mr-0.5 h-4 w-4 shrink-0 text-amber-500 motion-safe:animate-pulse"
          strokeWidth={2}
          role="img"
          aria-label={label}
        />
      ) : (
        <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
          <AnimatedWorkLogo active ikunVariant={ikunVariant} mode={swimMode} phase="trail" size="sm" />
        </span>
      )}
      <span className={awaitingUserInput ? 'font-medium text-amber-600 dark:text-amber-300' : 'ds-shiny-text'}>
        {label}
      </span>
      {typeof liveStartedAtMs === 'number' ? (
        <span
          className={`tabular-nums ${awaitingUserInput ? 'text-amber-600 dark:text-amber-300' : 'ds-shiny-text'}`}
        >
          {' · '}
          <LiveElapsedText sinceMs={liveStartedAtMs} />
        </span>
      ) : null}
    </div>
  )
}
