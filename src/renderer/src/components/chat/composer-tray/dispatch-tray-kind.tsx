import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import {
  formatDispatchableNames,
  isDispatchManagerThread,
  openAgentCenter,
  useDispatchableAgentNames
} from '../FloatingComposerDispatchableAgents'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import type { TrayKind } from './tray-kind'
import { TrayDot, TraySegmentContent } from './tray-primitives'

/**
 * Dispatchable agents segment, shown on a manager (ADE) session that has no
 * workers yet: bot icon + "可派 3 个 Agent", or a warning "没有可派的 agent"
 * when nothing is ready. It is not expandable: a click opens the Agent Center
 * (Settings > agentsHarnesses), where the dispatchable set is managed. The
 * names are in the tooltip and the accessible name. The tray drops this
 * segment whenever the Workers kind is present; the Workers sheet footer then
 * lists the same agents.
 */
export function useDispatchTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const manager = isDispatchManagerThread(context.activeThread, context.adeComposerEnabled === true)
  const names = useDispatchableAgentNames(manager)
  const openSettings: unknown = context.openSettings

  return useMemo((): TrayKind | null => {
    if (!manager) return null
    const empty = names.length === 0
    const label = empty
      ? t('adeDispatchableNone')
      : t('composerTrayWorkers.dispatchable', { count: names.length })
    const listed = empty ? label : t('adeDispatchable', { names: formatDispatchableNames(names) })
    return {
      id: 'dispatch',
      align: 'start',
      tone: empty ? 'waiting' : 'default',
      ariaLabel: empty
        ? label
        : t('composerTrayWorkers.dispatchableAria', { label, names: names.join(', ') }),
      title: `${listed}\n${t('adeDispatchableHint')}`,
      segmentAttributes: { 'data-dispatchable-agents-pill': 'true' },
      renderSegment: ({ compact }) => (
        <TraySegmentContent
          icon={<Bot className="h-3.5 w-3.5" strokeWidth={1.9} />}
          label={label}
          tone={empty ? 'waiting' : undefined}
          count={compact && !empty ? names.length : undefined}
          compact={compact}
          trailing={compact && empty ? <TrayDot tone="waiting" /> : undefined}
        />
      ),
      renderSheet: null,
      onActivate: () => openAgentCenter(openSettings)
    }
  }, [manager, names, openSettings, t])
}
