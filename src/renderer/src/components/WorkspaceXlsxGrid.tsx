import wasmUrl from '@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url'
import {
  setWasmSource,
  useXlsxViewerController,
  XlsxViewer,
  type XlsxViewerController
} from '@extend-ai/react-xlsx'
import { Check, Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import i18n from '../i18n'
import type { WorkspaceOfficePreviewSuccess, WorkspaceOfficeSelection } from '@shared/office-document'
import { subscribeKnowledgeSourceNavigation } from '../lib/knowledge-source-navigation'
import {
  OFFICE_ICON_BUTTON,
  OfficeToolbarStatus,
  OfficeZoomStepper,
  WorkspaceOfficeToolbar
} from './WorkspaceOfficeToolbar'
import { formatXlsxStat, readXlsxSelection, summarizeXlsxSelection, xlsxRangeLabel, type XlsxSelectionSummary } from './workspace-xlsx-selection'
import { WorkSheetSelectionAssist } from './write/WorkSheetSelectionAssist'

setWasmSource(wasmUrl)

const SELECTION_DEBOUNCE_MS = 150
const HIGHLIGHT_MS = 4_000

export type WorkspaceXlsxGridProps = {
  result: WorkspaceOfficePreviewSuccess
  /** Stable for a given file version, so an unchanged re-read keeps the open workbook. */
  source: Uint8Array
  loading: boolean
  refreshError?: string | null
  onSelectionChange?: (selection: WorkspaceOfficeSelection) => void
}

function useDocumentDarkMode(): boolean {
  const read = (): boolean => document.documentElement.dataset.theme === 'dark'
  const [dark, setDark] = useState(read)
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => setDark(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`
}

/**
 * The browser-native Excel renderer: a virtualized, read-only grid with frozen
 * panes, merged cells, number formats, charts and images. It is split from
 * WorkspaceSpreadsheetPreview so the Wasm engine loads only when a workbook opens.
 */
export function WorkspaceXlsxGrid({
  result,
  source,
  loading,
  refreshError,
  onSelectionChange
}: WorkspaceXlsxGridProps): ReactElement {
  const dark = useDocumentDarkMode()
  const file = useMemo(
    () => source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer,
    [source]
  )
  const controller = useXlsxViewerController({
    file,
    fileName: result.name,
    readOnly: true,
    allowResizeInReadOnly: true,
    useWorker: true
  })
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange
  const interactedRef = useRef(false)
  const hadSelectionRef = useRef(false)
  const sheetToRestoreRef = useRef<string | null>(null)
  const lastSheetRef = useRef<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [summary, setSummary] = useState<XlsxSelectionSummary | null>(null)

  const activeSheetName = controller.activeSheet?.name ?? null
  if (activeSheetName) lastSheetRef.current = activeSheetName

  // A changed file reloads the workbook; come back to the worksheet the reader was on.
  const loadedFileRef = useRef(file)
  if (loadedFileRef.current !== file) {
    loadedFileRef.current = file
    sheetToRestoreRef.current = lastSheetRef.current
    interactedRef.current = false
  }
  useEffect(() => {
    const wanted = sheetToRestoreRef.current
    if (!wanted || controller.isLoading || controller.sheets.length === 0) return
    sheetToRestoreRef.current = null
    const index = controller.sheets.findIndex((sheet) => sheet.name === wanted)
    if (index > 0) controller.setActiveSheetIndex(index)
  }, [controller, controller.isLoading, controller.sheets])

  const emitSelection = (selection: WorkspaceOfficeSelection): void => {
    onSelectionChangeRef.current?.(selection)
  }
  const emitEmpty = (): void => {
    hadSelectionRef.current = false
    setSummary(null)
    emitSelection({ sourceKind: 'spreadsheet', sourceFormat: result.sourceFormat, text: '', charCount: 0 })
  }

  const range = controller.selection
    ?? (interactedRef.current && controller.activeCell
      ? { start: controller.activeCell, end: controller.activeCell }
      : null)
  const rangeKey = range
    ? `${activeSheetName}!${range.start.row}:${range.start.col}:${range.end.row}:${range.end.col}`
    : ''
  useEffect(() => {
    if (!onSelectionChangeRef.current) return
    const current = controllerRef.current
    if (!rangeKey || !range || !current.activeSheet || current.isLoading) {
      if (hadSelectionRef.current) emitEmpty()
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      readXlsxSelection(current, range, abort.signal).then(({ text, formulas }) => {
        if (abort.signal.aborted) return
        const selectionText = text || formulas.join('\n')
        if (!selectionText) {
          if (hadSelectionRef.current) emitEmpty()
          return
        }
        hadSelectionRef.current = true
        setSummary(text ? summarizeXlsxSelection(text) : null)
        emitSelection({
          sourceKind: 'spreadsheet',
          sourceFormat: result.sourceFormat,
          text: selectionText,
          charCount: Array.from(selectionText).length,
          sheetName: current.activeSheet?.name,
          cellRange: xlsxRangeLabel(range),
          formulas
        })
      }, () => undefined)
    }, SELECTION_DEBOUNCE_MS)
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
    // `range` is derived from `rangeKey`; the key is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, controller.isLoading, result.sourceFormat])

  useEffect(() => () => {
    if (hadSelectionRef.current) emitEmpty()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => subscribeKnowledgeSourceNavigation(result.path, (location) => {
    if (location.kind !== 'spreadsheet') return false
    const current = controllerRef.current
    const reference = `${quoteSheetName(location.sheetName)}!${location.range}`
    if (!current.highlightRanges(reference, { autoScroll: true })) return false
    window.setTimeout(() => controllerRef.current.clearHighlightedRanges(), HIGHLIGHT_MS)
    return true
  }), [result.path])

  const copySelection = (): void => {
    void controllerRef.current.copySelectionToClipboard().then(
      (copied) => setCopyState(copied ? 'copied' : 'failed'),
      () => setCopyState('failed')
    )
  }
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 1_600)
    return () => window.clearTimeout(timer)
  }, [copyState])

  const unavailable = (
    <div className="kun-office-state">
      <span className="kun-office-state__body" role="alert">
        <strong>{i18n.t('officeSheetOpenFailed')}</strong>
        <span>{i18n.t('officeSheetRenderError')}</span>
      </span>
    </div>
  )
  const hasSelection = Boolean(controller.selection || controller.activeCell)

  return (
    <div
      className="kun-xlsx flex min-h-0 flex-1 flex-col"
      onPointerDownCapture={() => { interactedRef.current = true }}
      onKeyDownCapture={() => { interactedRef.current = true }}
    >
      <WorkspaceOfficeToolbar
        leading={(
          <>
            <span className="shrink-0 rounded border border-ds-border-muted px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-ds-faint">
              {result.sourceFormat}
            </span>
            {controller.selectedRangeAddress && interactedRef.current ? (
              <span className="ml-1 truncate font-mono text-[11.5px] text-ds-ink">{controller.selectedRangeAddress}</span>
            ) : null}
            {summary && summary.cells > 1 && interactedRef.current ? (
              <span className="kun-xlsx-stats" data-xlsx-stats>
                {summary.numbers > 0 ? (
                  <>
                    <span>{i18n.t('officeSheetStatMean', { value: formatXlsxStat(summary.mean, i18n.language) })}</span>
                    <span>{i18n.t('officeSheetStatSum', { value: formatXlsxStat(summary.sum, i18n.language) })}</span>
                  </>
                ) : null}
                <span>{i18n.t('officeSheetStatCells', { count: summary.cells })}</span>
              </span>
            ) : null}
          </>
        )}
        status={<OfficeToolbarStatus loading={loading} message={refreshError} />}
        trailing={(
          <>
            <OfficeZoomStepper
              percent={controller.zoomScale}
              canZoomIn={controller.canZoomIn}
              canZoomOut={controller.canZoomOut}
              disabled={controller.isLoading}
              onZoomIn={controller.zoomIn}
              onZoomOut={controller.zoomOut}
              onReset={controller.resetZoom}
            />
            <span aria-hidden className="mx-1 h-4 w-px bg-ds-border-muted" />
            <button
              type="button"
              aria-label={i18n.t('filePreviewCopySelection')}
              title={copyState === 'failed' ? i18n.t('officeCopyFailed') : i18n.t('filePreviewCopySelection')}
              disabled={controller.isLoading || !hasSelection}
              className={OFFICE_ICON_BUTTON}
              onClick={copySelection}
            >
              {copyState === 'copied'
                ? <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2} />
                : <Copy className={`h-3.5 w-3.5 ${copyState === 'failed' ? 'text-red-600' : ''}`} strokeWidth={1.8} />}
            </button>
          </>
        )}
      />
      <div className="kun-office-scroll relative min-h-0 flex-1">
        <XlsxViewer
          controller={controller}
          height="100%"
          isDark={dark}
          readOnly
          allowResizeInReadOnly
          showDefaultToolbar={false}
          loadingState={(
            <div className="kun-office-state" role="status">
              <span className="kun-office-state__body">
                <span className="kun-office-state__spinner" aria-hidden />
                {i18n.t('officeWorkbookLoading')}
              </span>
            </div>
          )}
          errorState={unavailable}
          fileTooLargeState={unavailable}
        />
        {summary && summary.cells > 0 && interactedRef.current && range ? (
          <WorkSheetSelectionAssist rangeLabel={xlsxRangeLabel(range)} numeric={summary.numbers > 1} />
        ) : null}
      </div>
      {controller.tabs.length > 1 ? (
        <div role="tablist" aria-label={i18n.t('officeWorksheet')} className="kun-xlsx-tabs">
          {controller.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.index === controller.activeTabIndex}
              title={tab.visibility && tab.visibility !== 'visible' ? `${tab.name} (${tab.visibility})` : tab.name}
              className="kun-xlsx-tab"
              onClick={() => controller.setActiveTabIndex(tab.index)}
            >
              <span className="truncate">{tab.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
