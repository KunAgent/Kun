import { useMemo, type ReactElement } from 'react'
import type { CoreTurnItemJson } from '../../agent/kun-contract'
import { chartSpecFromToolItem } from '../../agent/chart-spec-adapter'
import { toolBlockFromItem } from '../../agent/kun-mapper-tools'
import type { ToolBlock } from '../../agent/types'
import { ChartRenderer } from '../chat/ChartRenderer'
import { ConversationVisualizationCard } from '../chat/ConversationVisualizationCard'
import { GeneratedFilesPanel } from '../chat/message-timeline-media-views'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import { useRoomRun } from './useRoomRun'

export function structuredRoomRunArtifacts(items: CoreTurnItemJson[]): {
  charts: Array<{ id: string; spec: NonNullable<ReturnType<typeof chartSpecFromToolItem>> }>
  visualizations: ToolBlock[]
  generatedFiles: ToolBlock[]
} {
  const charts = []
  const visualizations: ToolBlock[] = []
  const generatedFiles: ToolBlock[] = []
  for (const item of items) {
    if (item.kind !== 'tool_result' || item.isError) continue
    const block = toolBlockFromItem(item)
    const spec = chartSpecFromToolItem(item)
    if (spec) charts.push({ id: item.id, spec })
    if (block.meta?.conversationVisualization) visualizations.push(block)
    if (Array.isArray(block.meta?.generatedFiles) && block.meta.generatedFiles.length) {
      generatedFiles.push(block)
    }
  }
  return { charts, visualizations, generatedFiles }
}

/** Code and Rooms share the same structured tool-result renderers. */
export function RoomRunArtifacts({ roomId, runId }: { roomId: string; runId?: string }): ReactElement | null {
  if (!runId) return null
  return <ActiveRoomRunArtifacts roomId={roomId} runId={runId} />
}

function ActiveRoomRunArtifacts({ roomId, runId }: { roomId: string; runId: string }): ReactElement | null {
  const { items, detail } = useRoomRun(roomId, runId, true)
  const artifacts = useMemo(() => structuredRoomRunArtifacts(items), [items])
  if (!artifacts.charts.length && !artifacts.visualizations.length && !artifacts.generatedFiles.length) return null
  return (
    <section className="rooms-run-artifacts" aria-label="Generated results">
      {artifacts.charts.map((chart) => <ChartRenderer key={chart.id} spec={chart.spec} />)}
      {artifacts.visualizations.map((block) => <ConversationVisualizationCard key={block.id} block={block} />)}
      {detail?.workspaceRoot ? <TimelineFilePreviewWorkspaceProvider workspaceRoot={detail.workspaceRoot} threadId={detail.run.threadId}>
        <GeneratedFilesPanel blocks={artifacts.generatedFiles} placement="turn" />
      </TimelineFilePreviewWorkspaceProvider> : null}
    </section>
  )
}
