import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { selectGraphPlanningCorrectionDraft, useGraphStore } from '../../../graph/graph-store'
import type { GraphChildRuntime, GraphRun } from '../../../graph/graph-types'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import {
  composerGraphAttention,
  composerGraphSegmentTitles,
  getComposerGraphProgress,
  selectThreadComposerGraphRun,
  type ComposerGraphAttentionReason
} from '../composer-graph-preview'
import {
  GraphCorrectionSegment,
  GraphPlanningCorrectionSheet,
  GraphProgressSegment,
  GraphProgressSheet
} from '../FloatingComposerGraphProgress'
import type { GraphOpenChildHandler } from '../FloatingComposerGraphPreview'
import type { TrayKind, TrayTone } from './tray-kind'

/*
 * Graph run segment ("Graph · 前端表单、后端接口 ▬▬ 1/5", first in the bar)
 * and its sheet (Graph board): header "Graph 编排 · 已验收 c / t 个节点 ·
 * n 个运行中" + "打开完整 Graph ↗", the node map, and the inspected node's
 * owner strip with "查看实时工作". With no live run but a plan draft that
 * needs the user, the segment turns into the amber "计划需要你的补充" whose
 * sheet lists the issues with 取消 / 继续规划.
 *
 * Gate: `context.showGraphProgress` (Kun code surface, Graph enabled, main
 * chat composer, active thread, runtime ready). While a run owns progress the
 * Todo kind demotes itself to a plan outline (graphRunOwnsThreadProgress).
 *
 * Markers: the tray puts `data-composer-stack-item="graph"` on the segment
 * slot; the segment button carries `data-graph-progress="c/t"` (plus the
 * counts and, while amber, `data-graph-attention-reason`) or
 * `data-graph-planning-correction`, which the plan-progress smoke reads.
 */

const NO_CHILD_RUNS: Readonly<Record<string, GraphChildRuntime>> = Object.freeze({})

/** Why the segment is amber: a node's reason, or the run waiting for a person. */
type GraphSegmentAttention = ComposerGraphAttentionReason | 'awaiting_human'

// Each reason has its own screen-reader sentence; quiet only means silence.
const SEGMENT_ARIA_KEYS: Record<GraphSegmentAttention, string> = {
  asking: 'composerTrayGraph.segmentAriaAsking',
  awaiting_human: 'composerTrayGraph.segmentAriaAwaiting',
  flagged: 'composerTrayGraph.segmentAriaFlagged',
  quiet: 'composerTrayGraph.segmentAriaQuiet'
}

/** A child asking outranks the run-level wait, which outranks a flag or silence. */
function graphSegmentAttention(
  runStatus: GraphRun['status'],
  reason: ComposerGraphAttentionReason | null
): GraphSegmentAttention | null {
  if (reason === 'asking') return 'asking'
  if (runStatus === 'awaiting_human') return 'awaiting_human'
  return reason
}

/**
 * Attention reason of the live run without a ticking clock: it re-renders
 * once when the next running node crosses the quiet threshold, and store
 * updates (new child activity) re-evaluate it on their own.
 */
function useGraphRunAttention(
  run: GraphRun | null,
  childRuns: Readonly<Record<string, GraphChildRuntime>>
): ComposerGraphAttentionReason | null {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { reason, quietDeadline } = useMemo(
    () => (run
      ? composerGraphAttention(run, childRuns, nowMs)
      : { attention: false, reason: null, quietDeadline: null }),
    [run, childRuns, nowMs]
  )
  useEffect(() => {
    if (quietDeadline == null || typeof window === 'undefined') return
    // A stale clock can put the deadline in the past; firing at once
    // re-reads the time and either flips to quiet or reschedules.
    const timer = window.setTimeout(() => setNowMs(Date.now()), Math.max(0, quietDeadline - Date.now()) + 50)
    return () => window.clearTimeout(timer)
  }, [quietDeadline])
  return reason
}

export function useGraphTrayKind(context: FloatingComposerRenderContext): TrayKind | null {
  const { t } = useTranslation('common')
  const enabled = context.showGraphProgress === true
  const threadId = typeof context.activeThreadId === 'string' && context.activeThreadId
    ? context.activeThreadId
    : null
  const onOpenGraph = typeof context.onOpenGraph === 'function'
    ? context.onOpenGraph as (runId: string, nodeId?: string) => void
    : undefined
  const onOpenChild = typeof context.onOpenGraphChild === 'function'
    ? context.onOpenGraphChild as GraphOpenChildHandler
    : undefined
  const refreshThread = useGraphStore((state) => state.refreshThread)
  const resumeDraft = useGraphStore((state) => state.resumeDraft)
  const cancelDraft = useGraphStore((state) => state.cancelDraft)
  const run = useGraphStore((state) => (
    enabled ? selectThreadComposerGraphRun(state.runs, threadId, state.selectedRunId) : null
  ))
  const correction = useGraphStore((state) => (
    enabled && !run ? selectGraphPlanningCorrectionDraft(state.drafts, threadId) : null
  ))
  // Child activity changes often; only a live run subscribes to it.
  const childRuns = useGraphStore((state) => (run ? state.childRuns : NO_CHILD_RUNS))

  useEffect(() => {
    if (!enabled || !threadId) return
    void refreshThread(threadId)
  }, [enabled, refreshThread, threadId])

  const progress = useMemo(
    () => (run ? getComposerGraphProgress(run, childRuns) : null),
    [run, childRuns]
  )
  const attentionReason = useGraphRunAttention(run, childRuns)

  if (run && progress) {
    const status = t(`graphStatus_${run.status}`, { defaultValue: run.status })
    const titles = composerGraphSegmentTitles(progress)
    const separator = t('composerTrayGraph.titleSeparator')
    const label = titles.length > 0
      ? t('composerTrayGraph.segmentLabel', { titles: titles.join(separator) })
      : t('composerTrayGraph.segmentLabelStatus', { status })
    const fullLabel = progress.activeNodeTitles.length > titles.length
      ? t('composerTrayGraph.segmentLabel', { titles: progress.activeNodeTitles.join(separator) })
      : label
    const attention = graphSegmentAttention(run.status, attentionReason)
    const waiting = attention != null
    const tone: TrayTone = waiting
      ? 'waiting'
      : run.status === 'paused' || run.status === 'pausing' ? 'default' : 'running'
    const counts = { accepted: progress.completed, total: progress.total, running: progress.activeCount }
    return {
      id: 'graph',
      align: 'start',
      tone,
      ariaLabel: t(attention ? SEGMENT_ARIA_KEYS[attention] : 'composerTrayGraph.segmentAria', counts),
      title: fullLabel,
      segmentAttributes: {
        'data-graph-run': run.id,
        'data-graph-progress': `${progress.completed}/${progress.total}`,
        'data-graph-accepted': progress.completed,
        'data-graph-total': progress.total,
        'data-graph-running': progress.activeCount,
        'data-graph-attention': waiting ? 'true' : undefined,
        'data-graph-attention-reason': attention ?? undefined
      },
      renderSegment: ({ compact }) => (
        <GraphProgressSegment
          label={label}
          accepted={progress.completed}
          total={progress.total}
          fraction={progress.fraction}
          waiting={waiting}
          compact={compact}
        />
      ),
      renderSheet: ({ close }) => (
        <GraphProgressSheet
          run={run}
          progress={progress}
          childRuns={childRuns}
          onOpenGraph={onOpenGraph}
          onOpenChild={onOpenChild}
          onClose={close}
        />
      )
    }
  }

  if (correction) {
    const issue = correction.draft.issues[0]
    return {
      id: 'graph',
      align: 'start',
      tone: 'waiting',
      ariaLabel: t('composerTrayGraph.correctionAria'),
      title: issue
        ? `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}`
        : t('composerTrayGraph.correctionNote'),
      segmentAttributes: {
        'data-graph-planning-correction': 'true',
        'data-graph-planning-draft': correction.draft.id
      },
      renderSegment: ({ compact }) => <GraphCorrectionSegment compact={compact} />,
      renderSheet: ({ close }) => (
        <GraphPlanningCorrectionSheet
          correction={correction}
          onResume={resumeDraft}
          onCancel={cancelDraft}
          onClose={close}
        />
      )
    }
  }

  return null
}
