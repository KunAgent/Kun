import type { ReactElement } from 'react'
import { WritePaperReadingSettingsPanel } from './settings-section-write-paper'

/** Paper mode: reading, search sources and translation, as its own page. */
export function PaperSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  return <WritePaperReadingSettingsPanel form={ctx.form} update={ctx.update} />
}
