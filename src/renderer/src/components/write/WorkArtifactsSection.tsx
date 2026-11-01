import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Shapes } from 'lucide-react'
import { useChatStore } from '../../store/chat-store'
import { useArtifactLibraryStore, openArtifactsPage } from '../../artifacts/artifact-library-store'
import { normalizeWorkspaceRoot } from '../../lib/workspace-path'
import { SidebarTreeRow } from '../sidebar/SidebarPrimitives'

/**
 * One row replaces the expanded whiteboard list. The board index is not read
 * here: the count only appears once the library has already scanned this space.
 */
export function WorkArtifactsSection({ workspaceRoot }: { workspaceRoot: string }): ReactElement {
  const { t } = useTranslation('common')
  const active = useChatStore((state) => state.route === 'artifacts')
  const items = useArtifactLibraryStore((state) => state.items)
  const scannedRoot = useArtifactLibraryStore((state) => state.workRoot)
  const root = workspaceRoot.trim() ? normalizeWorkspaceRoot(workspaceRoot) : ''
  const cached = root && scannedRoot && normalizeWorkspaceRoot(scannedRoot) === root
    ? items.filter((item) => normalizeWorkspaceRoot(item.workspaceRoot) === root).length
    : 0

  return (
    <div data-work-artifacts-entry="true">
      <SidebarTreeRow
        title={t('artifactsNav')}
        ariaLabel={t('artifactsNav')}
        active={active}
        onClick={() => openArtifactsPage({ from: 'work', workRoot: workspaceRoot })}
        className="min-h-[34px]"
        buttonStyle={{ paddingLeft: 10 }}
        actionsVisibility="hidden"
        actionsLayout="overlay"
        trailing={cached > 0 ? (
          <span className="text-[11px] tabular-nums text-ds-faint">{cached}</span>
        ) : null}
      >
        <Shapes className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 truncate">{t('artifactsNav')}</span>
      </SidebarTreeRow>
    </div>
  )
}
