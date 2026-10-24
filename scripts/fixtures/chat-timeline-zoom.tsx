import { useRef, type ReactElement } from 'react'
import { TimelineVirtualList } from '../../src/renderer/src/components/chat/TimelineVirtualList'

type Record = { id: string }
const records: Record[] = Array.from({ length: 150 }, (_, index) => ({ id: `zoom-row-${index}` }))
const recordKey = (record: Record): string => record.id

/** Real layout is required: jsdom does not implement CSS zoom or scrolling. */
export function ChatTimelineZoomFixture(): ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null)
  return (
    <div ref={viewportRef} data-testid="zoom-viewport" className="min-h-0 flex-1 overflow-y-auto">
      <div style={{ height: 150 }}>Earlier conversation content</div>
      <TimelineVirtualList items={records} viewportRef={viewportRef} itemKey={recordKey}>
        {(record) => <div style={{ height: 28 }}>{record.id}</div>}
      </TimelineVirtualList>
      <div data-testid="zoom-status" style={{ height: 60 }}>Running command...</div>
    </div>
  )
}
