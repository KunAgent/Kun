import { useMemo, type ComponentProps, type ReactElement } from 'react'
import type { TurnProcessTimelineEntry } from './derive-turn-sections'
import { ProcessSectionRow } from './message-timeline-process'
import { TimelineRuntimeError } from './message-timeline-jump-preview'
import { TimelineVirtualList, TIMELINE_VIRTUAL_THRESHOLD } from './TimelineVirtualList'
import { keepInteractiveProcessBlock } from './message-timeline-process-grouping'

const entryKey = (entry: TurnProcessTimelineEntry): string =>
  entry.kind === 'process' ? entry.section.id : entry.block.id
const keepEntry = (entry: TurnProcessTimelineEntry): boolean =>
  entry.kind === 'process' && entry.section.blocks.some(keepInteractiveProcessBlock)
const containsBlock = (entry: TurnProcessTimelineEntry, blockId: string): boolean =>
  entry.kind === 'process' ? entry.section.blocks.some((block) => block.id === blockId) : entry.block.id === blockId
const estimateEntry = (entry: TurnProcessTimelineEntry): number => {
  if (entry.kind === 'runtime_error') return 88
  if (entry.section.kind !== 'output') return 40
  const block = entry.section.blocks[0]
  return block?.kind === 'assistant' ? Math.min(480, 48 + Math.ceil(block.text.length / 80) * 24) : 80
}

type Props = Omit<ComponentProps<typeof ProcessSectionRow>, 'section'> & {
  entries: readonly TurnProcessTimelineEntry[]
}

/** Adjacent assistant messages must not bypass virtualization as one huge row. */
export function VirtualProcessTimeline({ entries, ...rowProps }: Props): ReactElement {
  const rows = useMemo(() => {
    const count = entries.reduce((sum, entry) => sum + (
      entry.kind === 'process' && entry.section.kind === 'output' ? entry.section.blocks.length : 1
    ), 0)
    if (count <= TIMELINE_VIRTUAL_THRESHOLD) return entries
    return entries.flatMap((entry): TurnProcessTimelineEntry[] =>
      entry.kind === 'process' && entry.section.kind === 'output'
        ? entry.section.blocks.map((block) => ({
            kind: 'process', section: { id: `output-${block.id}`, kind: 'output', blocks: [block] }
          }))
        : [entry])
  }, [entries])
  return (
    <TimelineVirtualList items={rows} viewportRef={rowProps.viewportRef} itemKey={entryKey}
      estimateSize={estimateEntry} keepMounted={keepEntry} containsBlock={containsBlock} className="flex min-w-0 flex-col gap-1">
      {(entry) => entry.kind === 'runtime_error'
        ? <TimelineRuntimeError block={entry.block} />
        : <ProcessSectionRow section={entry.section} {...rowProps} />}
    </TimelineVirtualList>
  )
}
