import type { ReactElement } from 'react'
import { BookMarked, GraduationCap, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperUnitListEntry } from '@shared/paper/paper-types'
import { SidebarIconButton, SidebarSectionHeader, SidebarTreeRow } from '../../sidebar/SidebarPrimitives'
import { paperUnitSlugFromDir } from '../../../write/paper/paper-unit'

/**
 * Paper-units section for the Write sidebar (§6.6): lists `papersDir/*` units
 * for the active workspace. Clicking a unit opens the PDF/NOTES split layout;
 * the "+" action opens the import dialog.
 */
export function WritePaperSidebarSection({
  units,
  activeUnitDir,
  loading,
  onOpenUnit,
  onImport,
  onRefresh
}: {
  units: PaperUnitListEntry[]
  /** Workspace-relative dir of the unit containing the active file. */
  activeUnitDir: string | null
  loading: boolean
  onOpenUnit: (unit: PaperUnitListEntry) => void
  onImport: () => void
  onRefresh: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="mt-2">
      <SidebarSectionHeader
        label={t('writePaperSection')}
        actions={
          <>
            <SidebarIconButton
              onClick={onRefresh}
              title={t('writePaperRefreshUnits')}
              ariaLabel={t('writePaperRefreshUnits')}
              stopPropagation
            >
              <BookMarked className="h-3.5 w-3.5" strokeWidth={1.75} />
            </SidebarIconButton>
            <SidebarIconButton
              onClick={onImport}
              title={t('writePaperImportTitle')}
              ariaLabel={t('writePaperImportTitle')}
              tone="accent"
              stopPropagation
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            </SidebarIconButton>
          </>
        }
      />
      {loading ? (
        <div className="px-2 py-1 text-[12px] text-ds-faint">{t('writeLoadingShort')}</div>
      ) : units.length === 0 ? (
        <button
          type="button"
          onClick={onImport}
          className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <GraduationCap className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 truncate text-[13px]">{t('writePaperEmpty')}</span>
        </button>
      ) : (
        units.map((unit) => (
          <SidebarTreeRow
            key={unit.unitDir}
            active={unit.unitDir === activeUnitDir}
            title={`${unit.meta.title}\n${unit.unitDir}`}
            onClick={() => onOpenUnit(unit)}
            className="min-h-[32px]"
            buttonClassName="items-center gap-2 px-2.5 py-1.5"
          >
            <GraduationCap
              className={`h-3.5 w-3.5 shrink-0 ${unit.unitDir === activeUnitDir ? 'text-accent' : 'text-ds-faint/90'}`}
              strokeWidth={1.8}
            />
            <span className="min-w-0 flex-1 truncate text-[13px]">
              {unit.meta.title || paperUnitSlugFromDir(unit.unitDir)}
            </span>
            {unit.meta.year ? (
              <span className="shrink-0 text-[11px] text-ds-faint">{unit.meta.year}</span>
            ) : null}
          </SidebarTreeRow>
        ))
      )}
    </div>
  )
}
