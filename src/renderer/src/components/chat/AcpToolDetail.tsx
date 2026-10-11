import type { ReactElement } from 'react'
import type { ToolBlock } from '../../agent/types'
import { ToolBlockDetails } from './ToolBlockDetails'

/** Tool evidence has its own fields; final output never replaces the input. */
export function AcpToolDetail({ block }: { block: ToolBlock }): ReactElement {
  return <div data-acp-tool-detail><ToolBlockDetails block={block} /></div>
}
