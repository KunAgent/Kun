import type { ReactElement } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AgentUpdateControl } from './AgentUpdateControl'

type T = (key: string, options?: Record<string, unknown>) => string

/** Tab 4: version, updates and rollback. The update itself runs in `harness-update-runner`. */
export function AgentVersionTab({ row, t }: { row: AdeHarnessRow; t: T }): ReactElement {
  return <AgentUpdateControl row={row} t={t} />
}
