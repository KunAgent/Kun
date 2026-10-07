import type { ReactElement } from 'react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { AgentUpdateControl } from './AgentUpdateControl'

type T = (key: string, options?: Record<string, unknown>) => string

/** Tab 4: version, updates and rollback. The update flow itself is `AgentUpdateControl`. */
export function AgentVersionTab({ row, settings, onPatchHarness, beforeEnableCheck, t }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  onPatchHarness: (patch: Partial<KunHarnessSettingsV1>) => void
  beforeEnableCheck?: () => Promise<boolean>
  t: T
}): ReactElement {
  return <AgentUpdateControl row={row} settings={settings} patch={onPatchHarness} beforeCheck={beforeEnableCheck} t={t} />
}
