import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ArchiveRestore, FolderOpen, Loader2 } from 'lucide-react'
import type { LegacySessionDetectResult } from '@shared/kun-gui-api'
import { InlineNoticeView, SettingsCard, SettingRow, type InlineNotice } from './settings-controls'

type TranslateFn = (key: string, options?: Record<string, unknown>) => string

const buttonClass =
  'inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-50'

function sum(detection: LegacySessionDetectResult | null, key: 'threadCount' | 'newCount'): number {
  return detection?.sources.reduce((total, source) => total + source[key], 0) ?? 0
}

export function LegacySessionImportCard({
  t,
  tCommon
}: {
  t: TranslateFn
  tCommon: TranslateFn
}): ReactElement {
  const [detection, setDetection] = useState<LegacySessionDetectResult | null>(null)
  const [detecting, setDetecting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [notice, setNotice] = useState<InlineNotice | null>(null)

  const refreshDetection = useCallback(async () => {
    if (typeof window.kunGui?.detectLegacySessions !== 'function') {
      setDetecting(false)
      return
    }
    setDetecting(true)
    try {
      setDetection(await window.kunGui.detectLegacySessions())
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setDetecting(false)
    }
  }, [])

  useEffect(() => {
    void refreshDetection()
  }, [refreshDetection])

  const runImport = useCallback(
    async (sourceDir?: string) => {
      if (typeof window.kunGui?.importLegacySessions !== 'function') return
      setBusy(true)
      setNotice(null)
      try {
        const result = await window.kunGui.importLegacySessions(sourceDir)
        if (!result.ok) {
          setNotice({ tone: 'error', message: result.message })
          return
        }
        if (result.total === 0) {
          setNotice({ tone: 'info', message: t('legacyImportResultNone') })
          return
        }
        setNotice({
          tone: 'success',
          message: t('legacyImportResult', { imported: result.imported, skipped: result.skipped })
        })
        await refreshDetection()
        if (result.imported > 0 && typeof window.kunGui?.confirmDialog === 'function') {
          const restart = await window.kunGui.confirmDialog({
            message: t('legacyImportRestartTitle'),
            detail: t('legacyImportRestartDetail', { count: result.imported }),
            confirmLabel: t('legacyImportRestartConfirm'),
            cancelLabel: tCommon('cancel')
          })
          if (restart && typeof window.kunGui?.restartRuntime === 'function') {
            setRestarting(true)
            try {
              await window.kunGui.restartRuntime()
            } finally {
              setRestarting(false)
            }
          }
        }
      } catch (error) {
        setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        setBusy(false)
      }
    },
    [refreshDetection, t, tCommon]
  )

  const pickAndImport = useCallback(async () => {
    if (typeof window.kunGui?.pickLegacySessionDir !== 'function') return
    try {
      const picked = await window.kunGui.pickLegacySessionDir()
      if (picked.canceled || !picked.path) return
      await runImport(picked.path)
    } catch (error) {
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [runImport])

  const totalNew = sum(detection, 'newCount')
  const totalFound = sum(detection, 'threadCount')
  const working = busy || restarting

  const statusText = detecting
    ? t('legacyImportScanning')
    : totalNew > 0
      ? t('legacyImportFound', { count: totalNew })
      : totalFound > 0
        ? t('legacyImportAllPresent')
        : t('legacyImportNoneFound')

  return (
    <SettingsCard title={t('legacyImportTitle')} className="mt-6">
      <SettingRow
        title={t('legacyImportTitle')}
        description={t('legacyImportDesc')}
        wideControl
        control={
          <div className="flex w-full min-w-0 flex-col items-start gap-2.5">
            <div className="flex items-center gap-1.5 text-[13px] text-ds-muted">
              {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              <span>{statusText}</span>
            </div>

            {detection && detection.sources.length > 0 ? (
              <ul className="w-full space-y-1">
                {detection.sources.map((source) => (
                  <li
                    key={source.id}
                    className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-ds-faint"
                  >
                    <span className="font-medium text-ds-muted">
                      {t('legacyImportSourceCount', {
                        newCount: source.newCount,
                        total: source.threadCount
                      })}
                    </span>
                    <code className="break-all font-mono">{source.path}</code>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={buttonClass}
                disabled={working || detecting || totalNew === 0}
                onClick={() => void runImport()}
              >
                {busy && !restarting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArchiveRestore className="h-4 w-4" />
                )}
                {restarting ? t('legacyImportRestarting') : t('legacyImportButton')}
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={working}
                onClick={() => void pickAndImport()}
              >
                <FolderOpen className="h-4 w-4" />
                {t('legacyImportPick')}
              </button>
            </div>

            {notice ? <InlineNoticeView notice={notice} /> : null}
          </div>
        }
      />
    </SettingsCard>
  )
}
