import type { ReactElement } from 'react'
import { GraduationCap } from 'lucide-react'
import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import type { WritePaperReadingSettingsV1 } from '@shared/app-settings'
import {
  cancelPaperJob,
  fetchCoolNotes,
  interpretPaper,
  openPdfAsPaper,
  preprocessPaper,
  type PaperTranslate
} from '../../../write/paper/paper-actions'
import { openPaperInterpretation } from '../../../write/paper/paper-open-layout'
import { WritePaperBar } from './WritePaperBar'

/**
 * The strip rendered under the focused group's toolbar: the full paper bar for
 * unit files, or the "作为论文打开" hint for an ordinary workspace PDF (§6.3).
 * Returns null when neither applies.
 */
export function WritePaperStrip({
  workspaceRoot,
  paperReading,
  unitDir,
  meta,
  loosePdfPath,
  input,
  setInput,
  onSubmitPrompt,
  t
}: {
  workspaceRoot: string
  paperReading: WritePaperReadingSettingsV1
  /** Workspace-relative unit dir when the active file belongs to one. */
  unitDir: string | null
  meta: PaperUnitMeta | null
  /** Absolute path of the active loose PDF (outside any unit), else null. */
  loosePdfPath: string | null
  input: string
  setInput: (value: string) => void
  onSubmitPrompt?: (value: string) => void
  t: PaperTranslate
}): ReactElement | null {
  const deps = { workspaceRoot, settings: paperReading, t }

  if (unitDir && meta) {
    return (
      <WritePaperBar
        unitDir={unitDir}
        meta={meta}
        onCoolNotes={(force) => void fetchCoolNotes({ ...deps, unitDir, force })}
        onInterpret={() =>
          void interpretPaper({ ...deps, unitDir, meta, onSubmitPrompt, setInput, input })
        }
        onPreprocess={(force) => void preprocessPaper({ ...deps, unitDir, force })}
        onOpenInterpretation={(path) =>
          void openPaperInterpretation({ workspaceRoot, unitDir, path })
        }
        onCancel={cancelPaperJob}
      />
    )
  }

  if (loosePdfPath) {
    return (
      <div className="flex items-center gap-2 border-b border-ds-border-muted bg-ds-subtle/40 px-3 py-1.5">
        <GraduationCap className="h-4 w-4 shrink-0 text-accent" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-ds-muted">
          {t('writePaperLoosePdfHint')}
        </span>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/[0.08] px-2.5 text-[12px] font-medium text-accent transition hover:bg-accent/15"
          onClick={() => void openPdfAsPaper({ ...deps, pdfPath: loosePdfPath })}
        >
          <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.9} />
          {t('writePaperOpenAsPaper')}
        </button>
      </div>
    )
  }

  return null
}
