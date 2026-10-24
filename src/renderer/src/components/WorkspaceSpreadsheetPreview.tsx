import { lazy, Suspense, useRef, type ReactElement } from 'react'
import i18n from '../i18n'
import type { WorkspaceOfficePreviewSuccess, WorkspaceOfficeSelection } from '@shared/office-document'

const WorkspaceXlsxGrid = lazy(() =>
  import('./WorkspaceXlsxGrid').then((module) => ({ default: module.WorkspaceXlsxGrid }))
)

export function WorkspaceSpreadsheetPreview({
  result,
  loading,
  refreshError,
  onSelectionChange
}: {
  result: WorkspaceOfficePreviewSuccess
  loading: boolean
  refreshError?: string | null
  onSelectionChange?: (selection: WorkspaceOfficeSelection) => void
}): ReactElement {
  // A re-read of unchanged bytes keeps the open workbook instead of parsing it again.
  const sourceRef = useRef<{ key: string; data: Uint8Array } | null>(null)
  const sourceKey = `${result.path}\n${result.sourceSha256}`
  if (sourceRef.current?.key !== sourceKey) sourceRef.current = { key: sourceKey, data: result.data }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense
        fallback={(
          <div className="kun-office-scroll relative min-h-0 flex-1">
            <div className="kun-office-state" role="status">{i18n.t('officeWorkbookLoading')}</div>
          </div>
        )}
      >
        <WorkspaceXlsxGrid
          result={result}
          source={sourceRef.current.data}
          loading={loading}
          refreshError={refreshError}
          onSelectionChange={onSelectionChange}
        />
      </Suspense>
    </div>
  )
}
