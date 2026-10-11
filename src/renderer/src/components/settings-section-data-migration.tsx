import { settingsButtonClass } from './settings-button'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileArchive,
  FolderInput,
  PackagePlus,
  RefreshCw,
  ShieldAlert,
  Trash2
} from 'lucide-react'
import type {
  DataMigrationCategory,
  DataMigrationEstimate,
  DataMigrationFileConflictResolution,
  DataMigrationConflict,
  DataMigrationImportPlan,
  DataMigrationInspectionSummary,
  DataMigrationOperationStatus,
  DataMigrationProgress,
  DataMigrationReport,
  DataMigrationWorkspaceConflictStrategy
} from '@shared/data-migration'
import { SettingsSubTabs, SettingsTabPanel } from './settings-controls'

type Flow = 'landing' | 'export' | 'import' | 'report'
type DataMigrationTab = 'export' | 'import' | 'reports'
type DataMigrationLandingMode = 'all' | DataMigrationTab

const EXPORT_STEPS = ['scope', 'security', 'review', 'create'] as const
const IMPORT_STEPS = ['select', 'inspect', 'map', 'resolve', 'review', 'import'] as const
export const DEFAULT_CATEGORIES: DataMigrationCategory[] = [
  'workspace-files', 'thread-history', 'attachments', 'artifacts', 'memory',
  'portable-settings', 'renderer-state', 'workflows', 'schedules'
]

export function DataMigrationSettingsSection(): ReactElement {
  const { t } = useTranslation('settings')
  const api = window.kunGui.dataMigration
  const [flow, setFlow] = useState<Flow>('landing')
  const [activeTab, setActiveTab] = useState<DataMigrationTab>('export')
  const [status, setStatus] = useState<DataMigrationOperationStatus | null>(null)
  const [progress, setProgress] = useState<DataMigrationProgress | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DataMigrationReport | null>(null)

  const [exportStep, setExportStep] = useState(0)
  const [estimate, setEstimate] = useState<DataMigrationEstimate | null>(null)
  const [availableWorkspaces, setAvailableWorkspaces] = useState<DataMigrationEstimate['workspaces']>([])
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([])
  const [categories, setCategories] = useState<DataMigrationCategory[]>(DEFAULT_CATEGORIES)
  const [preset, setPreset] = useState<'complete' | 'smaller'>('complete')
  const [sensitiveAcknowledged, setSensitiveAcknowledged] = useState(false)
  const [unencryptedAcknowledged, setUnencryptedAcknowledged] = useState(false)
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('')
  const [showExportPassphrase, setShowExportPassphrase] = useState(false)
  const [outputPath, setOutputPath] = useState('')
  const [runningThreadPolicy, setRunningThreadPolicy] = useState<'wait' | 'interrupt' | 'omit'>('wait')
  const [exportOperationId, setExportOperationId] = useState(() => operationId('export'))
  const automaticEstimateStarted = useRef(false)

  const [importStep, setImportStep] = useState(0)
  const [packagePath, setPackagePath] = useState('')
  const [importPassphrase, setImportPassphrase] = useState('')
  const [showImportPassphrase, setShowImportPassphrase] = useState(false)
  const [inspection, setInspection] = useState<DataMigrationInspectionSummary | null>(null)
  const [destinationBaseRoot, setDestinationBaseRoot] = useState('')
  const [plan, setPlan] = useState<DataMigrationImportPlan | null>(null)
  const [importOperationId, setImportOperationId] = useState(() => operationId('import'))

  const refreshStatus = useCallback(async () => {
    const next = await api.getStatus()
    setStatus(next)
    setProgress(next.progress ?? null)
  }, [api])

  useEffect(() => {
    void refreshStatus().catch((reason) => setError(errorMessage(reason)))
    return api.onProgress((value) => {
      setProgress(value)
      void refreshStatus().catch(() => undefined)
    })
  }, [api, refreshStatus])

  const loadEstimate = useCallback(async () => {
    automaticEstimateStarted.current = true
    setBusy(true)
    setError('')
    try {
      const value = await api.estimateExport({
        operationId: exportOperationId,
        selectedWorkspaceIds: selectedWorkspaces,
        categories,
        preset,
        sensitiveContentAcknowledged: sensitiveAcknowledged
      })
      setEstimate(value)
      setAvailableWorkspaces((current) => {
        const byId = new Map(current.map((workspace) => [workspace.workspaceId, workspace]))
        for (const workspace of value.workspaces) byId.set(workspace.workspaceId, workspace)
        return [...byId.values()]
      })
      if (selectedWorkspaces.length === 0) setSelectedWorkspaces(value.workspaces.map((workspace) => workspace.workspaceId))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }, [api, categories, exportOperationId, preset, selectedWorkspaces, sensitiveAcknowledged])

  useEffect(() => {
    if (flow === 'export' && !estimate && !automaticEstimateStarted.current) {
      void loadEstimate()
    }
  }, [estimate, flow, loadEstimate])

  useEffect(() => {
    if (flow === 'landing') return
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('[data-migration-step-panel] h3')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [exportStep, flow, importStep])

  const startExport = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api.startExport({
        operationId: exportOperationId,
        outputPath,
        selectedWorkspaceIds: selectedWorkspaces,
        selectedThreadIds: [],
        categories,
        preset,
        sensitiveContentAcknowledged: sensitiveAcknowledged,
        unencryptedPackageAcknowledged: unencryptedAcknowledged,
        ...(exportPassphrase ? { passphrase: exportPassphrase } : {}),
        runningThreadPolicy
      })
      clearPasswords()
      setReport(result.report)
      setActiveTab('reports')
      setFlow('report')
      await refreshStatus()
    } catch (reason) {
      clearPasswords()
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const inspectPackage = async () => {
    setBusy(true)
    setError('')
    try {
      const value = await api.inspectPackage({ packagePath, ...(importPassphrase ? { passphrase: importPassphrase } : {}) })
      setInspection(value)
      setImportStep(1)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const replan = async (input?: {
    strategies?: Record<string, DataMigrationWorkspaceConflictStrategy>
    destinationRoots?: Record<string, string>
  }) => {
    if (!inspection || !destinationBaseRoot) return
    setBusy(true)
    setError('')
    try {
      const value = await api.planImport({
        operationId: importOperationId,
        inspectionId: inspection.inspectionId,
        destinationBaseRoot,
        ...(input?.strategies ? { strategies: input.strategies } : {}),
        ...(input?.destinationRoots ? { destinationRoots: input.destinationRoots } : {}),
        ...(input?.strategies
          ? { skippedWorkspaceIds: skippedWorkspaceIdsForStrategies(input.strategies) }
          : {})
      })
      setPlan(value)
      setImportStep(3)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const setWorkspaceStrategy = async (workspaceId: string, strategy: DataMigrationWorkspaceConflictStrategy) => {
    if (!plan) return
    if (strategy === 'replace' && !window.confirm(t('dataMigrationConfirmReplace'))) return
    const strategies = Object.fromEntries(plan.mappings.map((mapping) => [mapping.workspaceId, mapping.strategy]))
    strategies[workspaceId] = strategy
    const destinationRoots = Object.fromEntries(plan.mappings.flatMap((mapping) =>
      mapping.destinationRoot ? [[mapping.workspaceId, mapping.destinationRoot]] : []
    ))
    await replan({ strategies, destinationRoots })
  }

  const resolveConflict = (conflictId: string, resolution: DataMigrationFileConflictResolution) => {
    setPlan((current) => current ? resolvePlanConflict(current, conflictId, resolution) : current)
  }

  const toggleExportCategory = (category: DataMigrationCategory) => {
    automaticEstimateStarted.current = false
    setEstimate(null)
    setCategories((current) => {
      if (category === 'thread-history' && current.includes(category)) {
        return current.filter((item) =>
          item !== 'thread-history' && item !== 'attachments' && item !== 'artifacts' && item !== 'memory'
        )
      }
      const next = toggle(current, category)
      return category === 'attachments' || category === 'artifacts' || category === 'memory'
        ? [...new Set([...next, 'thread-history' as const])]
        : next
    })
  }

  const startImport = async () => {
    if (!inspection || !plan) return
    setBusy(true)
    setError('')
    try {
      const resolved = normalizeResolvedPlan(plan)
      const result = await api.startImport({
        operationId: importOperationId,
        inspectionId: inspection.inspectionId,
        packagePath,
        ...(importPassphrase ? { passphrase: importPassphrase } : {}),
        plan: resolved
      })
      clearPasswords()
      setReport(result.report)
      setActiveTab('reports')
      setFlow('report')
      await refreshStatus()
    } catch (reason) {
      clearPasswords()
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const choosePackage = async () => {
    const result = await api.pickImportPackage(packagePath || undefined)
    if (!result.canceled && result.path) {
      setPackagePath(result.path)
      setInspection(null)
      setPlan(null)
    }
  }

  const chooseDestination = async () => {
    const result = await api.pickDestinationDirectory(destinationBaseRoot || undefined)
    if (!result.canceled && result.path) {
      setDestinationBaseRoot(result.path)
      setImportStep(2)
    }
  }

  const chooseOutput = async () => {
    const result = await api.pickExportPackage(outputPath || undefined)
    if (!result.canceled && result.path) setOutputPath(result.path.endsWith('.kunpack') ? result.path : `${result.path}.kunpack`)
  }

  const clearPasswords = () => {
    setExportPassphrase('')
    setExportPassphraseConfirm('')
    setImportPassphrase('')
    setShowExportPassphrase(false)
    setShowImportPassphrase(false)
  }

  const backToLanding = () => {
    clearPasswords()
    setError('')
    setFlow('landing')
    void refreshStatus()
  }

  const beginExport = () => {
    if (busy || status?.activeOperationId) return
    clearPasswords()
    setActiveTab('export')
    automaticEstimateStarted.current = false
    setExportOperationId(operationId('export'))
    setExportStep(0)
    setEstimate(null)
    setSelectedWorkspaces([])
    setOutputPath('')
    setReport(null)
    setError('')
    setFlow('export')
  }

  const beginImport = () => {
    if (busy || status?.activeOperationId) return
    clearPasswords()
    setActiveTab('import')
    setImportOperationId(operationId('import'))
    setImportStep(0)
    setPackagePath('')
    setInspection(null)
    setDestinationBaseRoot('')
    setPlan(null)
    setReport(null)
    setError('')
    setFlow('import')
  }

  const openReport = (value: DataMigrationReport): void => {
    clearPasswords()
    setReport(value)
    setActiveTab('reports')
    setFlow('report')
  }

  const deleteReport = async (operationIdValue: string): Promise<void> => {
    await api.deleteReport(operationIdValue)
    await refreshStatus()
  }

  const recoverOperation = async (
    operationIdValue: string,
    action: 'resume' | 'rollback'
  ): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      setStatus(await api.recover(operationIdValue, action))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const exportSecurityValid = exportPassphrase
    ? exportPassphrase.length >= 8 && exportPassphrase === exportPassphraseConfirm
    : unencryptedAcknowledged
  const resolvedPlan = plan ? normalizeResolvedPlan(plan) : null
  const importReady = Boolean(resolvedPlan &&
    resolvedPlan.fatalIssueCount === 0 &&
    resolvedPlan.conflicts.every((conflict) => Boolean(conflict.resolution)) &&
    resolvedPlan.mappings.every((mapping) =>
      mapping.strategy === 'skip' || (mapping.compatible && mapping.unresolvedIssueCount === 0)
    ))
  const activeTabHasFlow =
    (activeTab === 'export' && flow === 'export') ||
    (activeTab === 'import' && flow === 'import') ||
    (activeTab === 'reports' && flow === 'report')
  const landingProps = {
    status,
    onExport: beginExport,
    onImport: beginImport,
    onOpenReport: openReport,
    onDeleteReport: deleteReport,
    onRecover: recoverOperation,
    busy
  }

  return (
    <section aria-labelledby="data-migration-title" className="space-y-6 pb-12" data-testid="data-migration-settings">
      <h2 id="data-migration-title" className="sr-only">{t('dataMigration')}</h2>
      {activeTabHasFlow ? (
        <div className="flex justify-end">
          <button className={settingsButtonClass()} type="button" onClick={backToLanding} >
            <ArrowLeft className="h-4 w-4" />{t('dataMigrationBack')}
          </button>
        </div>
      ) : null}

      {error ? <DataMigrationActionError message={error} /> : null}
      {progress && status?.activeOperationId ? (
        <DataMigrationProgressCard progress={progress} onCancel={() => {
          const effect = progress.cancellationEffect ?? 'stop'
          if (!window.confirm(t(`dataMigrationConfirmCancel_${effect}`))) return
          void api.cancel(progress.operationId).then(setStatus).catch((reason) => setError(errorMessage(reason)))
        }} />
      ) : null}

      <DataMigrationSafetyNotice />
      <SettingsSubTabs<DataMigrationTab>
        baseId="data-migration"
        ariaLabel={t('dataMigration')}
        items={[
          { id: 'export', label: t('dataMigrationCreateTitle'), icon: PackagePlus },
          { id: 'import', label: t('dataMigrationImportTitle'), icon: FolderInput },
          { id: 'reports', label: t('dataMigrationRecentReports'), icon: FileArchive }
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <SettingsTabPanel
        baseId="data-migration"
        tabId="export"
        active={activeTab === 'export'}
      >
        {flow === 'export' ? (
        <div className="space-y-5">
          <DataMigrationStepRail steps={EXPORT_STEPS.map((step) => t(`dataMigrationExportStep${capitalize(step)}`))} current={exportStep} />
          {exportStep === 0 ? (
            <Panel title={t('dataMigrationScopeTitle')} description={t('dataMigrationScopeBody')}>
              {busy && !estimate ? <Loading /> : null}
              {availableWorkspaces.length > 0 ? (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {availableWorkspaces.map((workspace) => (
                    <label key={workspace.workspaceId} className="flex items-start gap-3 rounded-xl border border-ds-border px-3 py-3">
                      <input type="checkbox" className="mt-1" checked={selectedWorkspaces.includes(workspace.workspaceId)} onChange={() => {
                        const next = toggle(selectedWorkspaces, workspace.workspaceId)
                        if (next.length === 0) return
                        automaticEstimateStarted.current = false
                        setSelectedWorkspaces(next)
                        setEstimate(null)
                      }} />
                      <span className="min-w-0 flex-1"><span className="block font-medium text-ds-ink">{workspace.displayName}</span><span className="block truncate text-[12px] text-ds-muted">{workspace.sourcePathDisplay}</span></span>
                      <span className="text-[12px] text-ds-muted">{formatBytes(workspace.logicalBytes)}</span>
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 flex justify-between"><button className={settingsButtonClass()} type="button"  onClick={() => void loadEstimate()}>{t('dataMigrationRefreshEstimate')}</button><button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={!estimate || selectedWorkspaces.length === 0} onClick={() => setExportStep(1)}>{t('dataMigrationContinue')}</button></div>
            </Panel>
          ) : null}
          {exportStep === 1 ? (
            <Panel title={t('dataMigrationSecurityTitle')} description={t('dataMigrationSecurityBody')}>
              <div className="grid gap-3 sm:grid-cols-2">
                {DEFAULT_CATEGORIES.map((category) => <label key={category} className="flex items-center gap-2 rounded-lg border border-ds-border px-3 py-2 text-[13px]"><input type="checkbox" checked={categories.includes(category)} onChange={() => toggleExportCategory(category)} />{t(`dataMigrationCategory_${category}`)}</label>)}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2"><Choice active={preset === 'complete'} title={t('dataMigrationPresetComplete')} body={t('dataMigrationPresetCompleteBody')} onClick={() => { automaticEstimateStarted.current = false; setPreset('complete'); setEstimate(null) }} /><Choice active={preset === 'smaller'} title={t('dataMigrationPresetSmaller')} body={t('dataMigrationPresetSmallerBody')} onClick={() => { automaticEstimateStarted.current = false; setPreset('smaller'); setEstimate(null) }} /></div>
              <div className="mt-5 rounded-xl border border-ds-border bg-ds-subtle/50 p-4">
                <label className="text-[13px] font-medium text-ds-ink">{t('dataMigrationPassphrase')}</label>
                <div className="mt-2 flex gap-2"><input className="settings-input flex-1" type={showExportPassphrase ? 'text' : 'password'} value={exportPassphrase} autoComplete="new-password" onChange={(event) => setExportPassphrase(event.target.value)} placeholder={t('dataMigrationPassphraseOptional')} /><button className={settingsButtonClass()} type="button"  onClick={() => setShowExportPassphrase((value) => !value)}>{showExportPassphrase ? t('hide') : t('show')}</button></div>
                {exportPassphrase ? <input className="settings-input mt-2 w-full" type="password" value={exportPassphraseConfirm} autoComplete="new-password" onChange={(event) => setExportPassphraseConfirm(event.target.value)} placeholder={t('dataMigrationPassphraseConfirm')} /> : (
                  <label className="mt-3 flex items-start gap-2 text-[12px] text-amber-700 dark:text-amber-200"><input type="checkbox" checked={unencryptedAcknowledged} onChange={(event) => setUnencryptedAcknowledged(event.target.checked)} />{t('dataMigrationUnencryptedAck')}</label>
                )}
                <p className="mt-2 text-[12px] text-ds-muted">{t('dataMigrationNoPasswordRecovery')}</p>
              </div>
              {categories.includes('workspace-files') && estimate && estimate.sensitiveFindings.length > 0 ? <label className="mt-3 flex items-start gap-2 rounded-xl border border-amber-300/60 p-3 text-[12px]"><input type="checkbox" checked={sensitiveAcknowledged} onChange={(event) => {
                automaticEstimateStarted.current = false
                setSensitiveAcknowledged(event.target.checked)
                setEstimate(null)
              }} />{t('dataMigrationSensitiveAck', { count: estimate.sensitiveFindings.length })}</label> : null}
              <label className="mt-4 block text-[13px] text-ds-muted">{t('dataMigrationRunningThreads')}<select className="settings-input mt-2 w-full" value={runningThreadPolicy} onChange={(event) => setRunningThreadPolicy(event.target.value as typeof runningThreadPolicy)}><option value="wait">{t('dataMigrationRunningWait')}</option><option value="interrupt">{t('dataMigrationRunningInterrupt')}</option><option value="omit">{t('dataMigrationRunningOmit')}</option></select></label>
              <WizardButtons back={() => setExportStep(0)} next={() => setExportStep(2)} nextDisabled={categories.length === 0 || !estimate || !exportSecurityValid || Boolean(categories.includes('workspace-files') && estimate.sensitiveFindings.length && !sensitiveAcknowledged)} />
            </Panel>
          ) : null}
          {exportStep === 2 ? (
            <Panel title={t('dataMigrationReviewTitle')} description={t('dataMigrationExportReviewBody')}>
              <Summary rows={[[t('dataMigrationWorkspaces'), String(selectedWorkspaces.length)], [t('dataMigrationEstimatedSize'), formatBytes(estimate?.estimatedPackageBytes ?? 0)], [t('dataMigrationEncryption'), exportPassphrase ? t('dataMigrationEncrypted') : t('dataMigrationUnencrypted')]]} />
              <div className="mt-4 flex gap-2"><input readOnly className="settings-input min-w-0 flex-1" value={outputPath} placeholder={t('dataMigrationChooseOutput')} /><button className={settingsButtonClass()} type="button"  onClick={() => void chooseOutput()}>{t('browse')}</button></div>
              <WizardButtons back={() => setExportStep(1)} next={() => setExportStep(3)} nextDisabled={!outputPath} nextLabel={t('dataMigrationCreatePackage')} />
            </Panel>
          ) : null}
          {exportStep === 3 ? <RunPanel kind="export" busy={busy} progress={progress} onStart={() => void startExport()} /> : null}
        </div>
        ) : <DataMigrationLanding {...landingProps} mode="export" />}
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="data-migration"
        tabId="import"
        active={activeTab === 'import'}
      >
        {flow === 'import' ? (
        <div className="space-y-5">
          <DataMigrationStepRail steps={IMPORT_STEPS.map((step) => t(`dataMigrationImportStep${capitalize(step)}`))} current={importStep} />
          {importStep === 0 ? <Panel title={t('dataMigrationSelectTitle')} description={t('dataMigrationSelectBody')}><div className="flex gap-2"><input readOnly className="settings-input min-w-0 flex-1" value={packagePath} /><button className={settingsButtonClass()} type="button"  onClick={() => void choosePackage()}>{t('browse')}</button></div><div className="mt-3 flex gap-2"><input className="settings-input flex-1" type={showImportPassphrase ? 'text' : 'password'} value={importPassphrase} autoComplete="off" onChange={(event) => setImportPassphrase(event.target.value)} placeholder={t('dataMigrationPassphraseIfNeeded')} /><button className={settingsButtonClass()} type="button"  onClick={() => setShowImportPassphrase((value) => !value)}>{showImportPassphrase ? t('hide') : t('show')}</button></div><div className="mt-4 flex justify-end"><button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={!packagePath || busy} onClick={() => void inspectPackage()}>{t('dataMigrationInspect')}</button></div></Panel> : null}
          {importStep === 1 && inspection ? <Panel title={t('dataMigrationInspectTitle')} description={t('dataMigrationInspectBody')}><Summary rows={[[t('dataMigrationSourceSystem'), `${inspection.sourcePlatform} / ${inspection.sourceArch}`], [t('dataMigrationCreatedAt'), new Date(inspection.createdAt).toLocaleString()], [t('dataMigrationWorkspaces'), String(inspection.workspaces.length)], [t('dataMigrationHistories'), String(inspection.threads.length)], [t('dataMigrationExpandedSize'), formatBytes(inspection.expandedBytes)], [t('dataMigrationEncryption'), inspection.encrypted ? t('dataMigrationEncrypted') : t('dataMigrationUnencrypted')]]} />{inspection.warnings.map((warning) => <p key={warning} className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-200">{warning}</p>)}<div className="mt-4 flex justify-between"><button className={settingsButtonClass()} type="button"  onClick={() => setImportStep(0)}>{t('dataMigrationBack')}</button><button type="button" className={settingsButtonClass({ variant: 'primary' })} onClick={() => setImportStep(2)}>{t('dataMigrationMapWorkspaces')}</button></div></Panel> : null}
          {importStep === 2 ? <Panel title={t('dataMigrationMapTitle')} description={t('dataMigrationMapBody')}><div className="flex gap-2"><input readOnly className="settings-input min-w-0 flex-1" value={destinationBaseRoot} /><button className={settingsButtonClass()} type="button"  onClick={() => void chooseDestination()}>{t('browse')}</button></div><div className="mt-4 flex justify-end"><button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={!destinationBaseRoot || busy} onClick={() => void replan()}>{t('dataMigrationBuildPlan')}</button></div></Panel> : null}
          {importStep === 3 && plan ? <Panel title={t('dataMigrationResolveTitle')} description={t('dataMigrationResolveBody')}><div className="max-h-72 space-y-2 overflow-y-auto">{plan.mappings.map((mapping) => <div key={mapping.workspaceId} className="rounded-xl border border-ds-border p-3"><div className="font-medium text-ds-ink">{mapping.sourcePathDisplay}</div><div className="mt-1 truncate text-[12px] text-ds-muted">→ {mapping.destinationRoot ?? t('dataMigrationSkipped')}</div><select className="settings-input mt-2 w-full" value={mapping.strategy} onChange={(event) => void setWorkspaceStrategy(mapping.workspaceId, event.target.value as DataMigrationWorkspaceConflictStrategy)}><option value="keep-both">{t('dataMigrationKeepBoth')}</option><option value="merge">{t('dataMigrationMerge')}</option><option value="replace">{t('dataMigrationReplace')}</option><option value="skip">{t('dataMigrationSkip')}</option></select></div>)}</div>{plan.conflicts.length > 0 ? <div className="mt-4"><div className="mb-2 flex flex-wrap gap-2"><button className={settingsButtonClass()} type="button"  onClick={() => setPlan(resolveAllPlanConflicts(plan, 'keep-target'))}>{t('dataMigrationApplyAllKeep')}</button><button className={settingsButtonClass()} type="button"  onClick={() => setPlan(resolveAllPlanConflicts(plan, 'import-sibling'))}>{t('dataMigrationApplyAllSibling')}</button><button className={settingsButtonClass()} type="button"  onClick={() => { if (window.confirm(t('dataMigrationConfirmReplace'))) setPlan(resolveAllPlanConflicts(plan, 'replace-with-backup')) }}>{t('dataMigrationApplyAllReplace')}</button></div><DataMigrationVirtualConflictList conflicts={plan.conflicts} onResolve={resolveConflict} /></div> : null}<WizardButtons back={() => setImportStep(2)} next={() => setImportStep(4)} nextDisabled={!importReady} /></Panel> : null}
          {importStep === 4 && inspection && plan ? <Panel title={t('dataMigrationReviewTitle')} description={t('dataMigrationImportReviewBody')}><Summary rows={[[t('dataMigrationWorkspaces'), String(plan.mappings.filter((mapping) => mapping.strategy !== 'skip').length)], [t('dataMigrationConflicts'), String(plan.conflicts.length)], [t('dataMigrationRequiredSpace'), formatBytes(plan.estimatedPeakBytes)], [t('dataMigrationDisabledItems'), String(plan.disabledItems.length)]]} /><div className="mt-3 rounded-xl border border-amber-300/60 bg-amber-500/5 p-3 text-[12px] text-amber-800 dark:text-amber-200"><ShieldAlert className="mr-2 inline h-4 w-4" />{t('dataMigrationTrustResetNotice')}</div><WizardButtons back={() => setImportStep(3)} next={() => setImportStep(5)} nextDisabled={!importReady} nextLabel={t('dataMigrationImportNow')} /></Panel> : null}
          {importStep === 5 ? <RunPanel kind="import" busy={busy} progress={progress} onStart={() => void startImport()} /> : null}
        </div>
        ) : <DataMigrationLanding {...landingProps} mode="import" />}
      </SettingsTabPanel>

      <SettingsTabPanel
        baseId="data-migration"
        tabId="reports"
        active={activeTab === 'reports'}
      >
        {flow === 'report' && report
          ? <DataMigrationReportView report={report} onDone={backToLanding} />
          : <DataMigrationLanding {...landingProps} mode="reports" />}
      </SettingsTabPanel>
      <span className="sr-only" role="status" aria-live="polite">{progress ? `${progress.phase}: ${progress.completedItems}` : ''}</span>
    </section>
  )
}

export function DataMigrationLanding(props: {
  status: DataMigrationOperationStatus | null
  onExport: () => void
  onImport: () => void
  onOpenReport: (report: DataMigrationReport) => void
  onDeleteReport: (operationId: string) => Promise<void>
  onRecover: (operationId: string, action: 'resume' | 'rollback') => Promise<void>
  busy: boolean
  mode?: DataMigrationLandingMode
}): ReactElement {
  const { t } = useTranslation('settings')
  const mode = props.mode ?? 'all'
  const showExport = mode === 'all' || mode === 'export'
  const showImport = mode === 'all' || mode === 'import'
  const showReports = mode === 'all' || mode === 'reports'
  const newMigrationDisabled = props.busy ||
    Boolean(props.status?.activeOperationId) ||
    Boolean(props.status?.recoverable.length)
  if (props.status && !props.status.featureEnabled && props.status.recoverable.length === 0) return <DataMigrationActionError message={t('dataMigrationFeatureDisabled')} />
  return <div className="space-y-5">
    {showReports ? props.status?.recoverable.map((item) => <div key={item.operationId} className="rounded-2xl border border-amber-300/70 bg-amber-500/5 p-5"><div className="flex items-center gap-2 font-semibold text-ds-ink"><AlertTriangle className="h-5 w-5 text-amber-600" />{t('dataMigrationRecoveryTitle')}</div><p className="mt-2 text-[13px] text-ds-muted">{t('dataMigrationRecoveryBody', { phase: item.phase, effect: item.destinationEffect })}</p>{item.error ? <p className="mt-2 text-[12px] text-ds-muted"><strong>{item.error.code}</strong> · {item.error.message}</p> : null}{item.manualRecoverySteps.length > 0 ? <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-amber-800 dark:text-amber-200">{item.manualRecoverySteps.map((step) => <li key={step}>{step}</li>)}</ul> : null}{item.reportPath ? <p className="mt-2 break-all text-[11px] text-ds-muted">{t('dataMigrationReportLocation')}: {item.reportPath}</p> : null}<div className="mt-4 flex gap-2">{canResumeMigrationPhase(item.phase) ? <button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={props.busy} onClick={() => void props.onRecover(item.operationId, 'resume')}>{t('dataMigrationResume')}</button> : null}<button className={settingsButtonClass()} type="button"  disabled={props.busy} onClick={() => void props.onRecover(item.operationId, 'rollback')}>{t('dataMigrationRollback')}</button></div></div>) : null}
    {showExport || showImport ? <div className={`grid gap-4 ${showExport && showImport ? 'sm:grid-cols-2' : ''}`}>
      {showExport ? <LandingCard icon={<PackagePlus />} title={t('dataMigrationCreateTitle')} body={t('dataMigrationCreateBody')} action={t('dataMigrationCreateAction')} onClick={props.onExport} disabled={newMigrationDisabled} /> : null}
      {showImport ? <LandingCard icon={<FolderInput />} title={t('dataMigrationImportTitle')} body={t('dataMigrationImportBody')} action={t('dataMigrationImportAction')} onClick={props.onImport} disabled={newMigrationDisabled} /> : null}
    </div> : null}
    {mode === 'all' ? <DataMigrationSafetyNotice /> : null}
    {showReports ? <div><h3 className="text-[14px] font-semibold text-ds-ink">{t('dataMigrationRecentReports')}</h3><div className="mt-2 space-y-2">{props.status?.recentReports.length ? props.status.recentReports.map((report) => <div key={report.operationId} className="flex items-center gap-3 rounded-xl border border-ds-border px-3 py-3"><StatusIcon outcome={report.outcome} /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => props.onOpenReport(report)}><span className="block font-medium text-ds-ink">{t(`dataMigrationOutcome_${report.outcome}`)}</span><span className="block text-[12px] text-ds-muted">{new Date(report.finishedAt).toLocaleString()} · {report.kind}</span></button><button type="button" aria-label={t('delete')} className={settingsButtonClass({ variant: 'danger-ghost', size: 'icon' })}  onClick={() => void props.onDeleteReport(report.operationId)}><Trash2 className="h-4 w-4" /></button></div>) : <p className="rounded-xl border border-dashed border-ds-border p-4 text-[13px] text-ds-muted">{t('dataMigrationNoReports')}</p>}</div></div> : null}
  </div>
}

function DataMigrationSafetyNotice(): ReactElement {
  const { t } = useTranslation('settings')
  return <div className="rounded-2xl border border-ds-border bg-ds-subtle/40 p-5"><div className="flex items-center gap-2 font-medium text-ds-ink"><ShieldAlert className="h-4 w-4" />{t('dataMigrationNeverTransferredTitle')}</div><p className="mt-2 text-[13px] leading-6 text-ds-muted">{t('dataMigrationNeverTransferredBody')}</p></div>
}

function LandingCard({ icon, title, body, action, onClick, disabled }: { icon: ReactElement; title: string; body: string; action: string; onClick: () => void; disabled: boolean }): ReactElement {
  return <button type="button" disabled={disabled} onClick={onClick} className="group rounded-2xl border border-ds-border bg-ds-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400/60 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><span className="mt-4 block text-[16px] font-semibold text-ds-ink">{title}</span><span className="mt-1 block text-[13px] leading-5 text-ds-muted">{body}</span><span className="mt-4 block text-[13px] font-medium text-blue-600">{action} →</span></button>
}

function Panel({ title, description, children }: { title: string; description: string; children: React.ReactNode }): ReactElement { return <div data-migration-step-panel className="rounded-2xl border border-ds-border bg-ds-card p-5 shadow-sm"><h3 tabIndex={-1} className="text-[16px] font-semibold text-ds-ink focus:outline-none">{title}</h3><p className="mt-1 text-[13px] leading-6 text-ds-muted">{description}</p><div className="mt-5">{children}</div></div> }
export function DataMigrationStepRail({ steps, current }: { steps: string[]; current: number }): ReactElement { return <ol className="flex gap-2 overflow-x-auto" aria-label="Migration steps">{steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium ${index === current ? 'bg-blue-600 text-white' : index < current ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200' : 'bg-ds-subtle text-ds-muted'}`}>{index + 1}. {step}</li>)}</ol> }
export function DataMigrationVirtualConflictList({ conflicts, onResolve }: { conflicts: DataMigrationConflict[]; onResolve: (id: string, resolution: DataMigrationFileConflictResolution) => void }): ReactElement { const { t } = useTranslation('settings'); const [scrollTop, setScrollTop] = useState(0); const rowHeight = 116; const viewportHeight = 320; const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3); const end = Math.min(conflicts.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 3); const labels: Record<DataMigrationFileConflictResolution, string> = { 'keep-target': t('dataMigrationKeepTarget'), 'import-sibling': t('dataMigrationSaveImportedCopy'), 'replace-with-backup': t('dataMigrationReplaceBackup'), skip: t('dataMigrationSkip'), 'rename-source': t('dataMigrationRenameSource') }; return <div className="relative overflow-y-auto rounded-xl border border-ds-border" style={{ height: viewportHeight }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} role="list" aria-label={t('dataMigrationConflictList')}><div className="relative" style={{ height: conflicts.length * rowHeight }}>{conflicts.slice(start, end).map((conflict, offset) => <div key={conflict.conflictId} role="listitem" className="absolute left-0 right-0 border-b border-ds-border p-3 text-[12px]" style={{ height: rowHeight, top: (start + offset) * rowHeight }}><div className="truncate font-medium text-ds-ink" title={conflict.path}>{conflict.path}</div><div className="text-ds-muted">{conflict.kind}</div><select aria-label={`${conflict.path} resolution`} className="settings-input mt-2 w-full" value={conflict.resolution ?? ''} onChange={(event) => onResolve(conflict.conflictId, event.target.value as DataMigrationFileConflictResolution)}><option value="">{t('dataMigrationChooseResolution')}</option>{allowedConflictResolutions(conflict).map((resolution) => <option key={resolution} value={resolution}>{labels[resolution]}</option>)}</select></div>)}</div></div> }
function Choice({ active, title, body, onClick }: { active: boolean; title: string; body: string; onClick: () => void }): ReactElement { return <button type="button" aria-pressed={active} onClick={onClick} className={`rounded-xl border p-3 text-left ${active ? 'border-blue-500 bg-blue-500/5' : 'border-ds-border'}`}><span className="block font-medium text-ds-ink">{title}</span><span className="mt-1 block text-[12px] text-ds-muted">{body}</span></button> }
function WizardButtons({ back, next, nextDisabled, nextLabel }: { back: () => void; next: () => void; nextDisabled?: boolean; nextLabel?: string }): ReactElement { const { t } = useTranslation('settings'); return <div className="mt-5 flex justify-between"><button className={settingsButtonClass()} type="button"  onClick={back}>{t('dataMigrationBack')}</button><button type="button" className={settingsButtonClass({ variant: 'primary' })} disabled={nextDisabled} onClick={next}>{nextLabel ?? t('dataMigrationContinue')}</button></div> }
function Summary({ rows }: { rows: string[][] }): ReactElement { return <dl className="divide-y divide-ds-border rounded-xl border border-ds-border">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 px-3 py-2.5 text-[13px]"><dt className="text-ds-muted">{label}</dt><dd className="text-right font-medium text-ds-ink">{value}</dd></div>)}</dl> }
function Loading(): ReactElement { return <div aria-busy="true" className="flex items-center gap-2 text-[13px] text-ds-muted"><RefreshCw className="h-4 w-4 animate-spin" />Loading…</div> }
export function DataMigrationActionError({ message }: { message: string }): ReactElement { const match = message.match(/\b([A-Z][A-Z_]+):\s*(.*)$/); return <div role="alert" className="rounded-xl border border-red-300/60 bg-red-500/5 p-4 text-[13px] leading-5 text-red-700 dark:text-red-200"><AlertTriangle className="mr-2 inline h-4 w-4" />{match ? <><strong className="mr-2">{match[1]}</strong><span>{match[2]}</span></> : message}</div> }

export function DataMigrationProgressCard({ progress, onCancel }: { progress: DataMigrationProgress; onCancel: () => void }): ReactElement { const { t } = useTranslation('settings'); const percent = progress.totalBytes ? Math.min(100, Math.round(progress.completedBytes / progress.totalBytes * 100)) : null; return <div className="rounded-2xl border border-blue-300/50 bg-blue-500/5 p-4" role="status"><div className="flex items-center justify-between gap-3"><div><div className="font-medium text-ds-ink">{t('dataMigrationProgressPhase', { phase: progress.phase })}</div><div className="text-[12px] text-ds-muted">{progress.completedItems}{progress.totalItems ? ` / ${progress.totalItems}` : ''} · {formatBytes(progress.completedBytes)}</div></div>{progress.cancellable ? <button className={settingsButtonClass()} type="button"  onClick={onCancel}>{t('dataMigrationCancel')}</button> : null}</div><div className="mt-3 h-2 overflow-hidden rounded-full bg-ds-subtle"><div className={`h-full bg-blue-600 transition-all ${percent === null ? 'w-1/3 animate-pulse' : ''}`} style={percent === null ? undefined : { width: `${percent}%` }} /></div><p className="mt-2 text-[11px] text-ds-muted">{progress.cancellationEffect ? t(`dataMigrationCancellation_${progress.cancellationEffect}`) : ''}</p></div> }

function RunPanel({ kind, busy, progress, onStart }: { kind: 'export' | 'import'; busy: boolean; progress: DataMigrationProgress | null; onStart: () => void }): ReactElement { const { t } = useTranslation('settings'); return <Panel title={kind === 'export' ? t('dataMigrationCreatePackage') : t('dataMigrationImportNow')} description={kind === 'export' ? t('dataMigrationCreateRunBody') : t('dataMigrationImportRunBody')}>{busy ? <Loading /> : <button type="button" className={settingsButtonClass({ variant: 'primary' })} onClick={onStart}>{kind === 'export' ? t('dataMigrationCreatePackage') : t('dataMigrationImportNow')}</button>}{progress ? <p className="mt-3 text-[12px] text-ds-muted">{progress.phase}</p> : null}</Panel> }
export function DataMigrationReportView({ report, onDone }: { report: DataMigrationReport; onDone: () => void }): ReactElement { const { t } = useTranslation('settings'); return <Panel title={t(`dataMigrationOutcome_${report.outcome}`)} description={t('dataMigrationReportBody')}><div className="flex items-center gap-3"><StatusIcon outcome={report.outcome} /><div><div className="font-medium text-ds-ink">{report.kind} · {report.packageId}</div><div className="text-[12px] text-ds-muted">{new Date(report.finishedAt).toLocaleString()}</div></div></div><Summary rows={[[t('dataMigrationWorkspaces'), String(Object.keys(report.workspacePathMap).length)], [t('dataMigrationHistories'), String(Object.keys(report.threadIdMap).length)], [t('dataMigrationWarnings'), String(report.warnings.length)], [t('dataMigrationUnresolved'), String(report.unresolvedReferences)], [t('dataMigrationDisabledItems'), String(report.disabledItems)]]} />{report.warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-amber-700 dark:text-amber-200">{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}{report.error ? <DataMigrationActionError message={`${report.error.code}: ${report.error.message} ${report.error.nextActions.join(' ')}`} /> : null}<div className="mt-5 flex justify-end"><button type="button" className={settingsButtonClass({ variant: 'primary' })} onClick={onDone}>{t('done')}</button></div></Panel> }
function StatusIcon({ outcome }: { outcome: DataMigrationReport['outcome'] }): ReactElement { return outcome === 'success' ? <CheckCircle2 aria-label="Success" className="h-5 w-5 text-emerald-600" /> : outcome === 'completed-with-review' ? <AlertTriangle aria-label="Review needed" className="h-5 w-5 text-amber-600" /> : <FileArchive aria-label={outcome} className="h-5 w-5 text-ds-muted" /> }

export function formatBytes(value: number): string { if (!Number.isFinite(value) || value <= 0) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024))); return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}` }
export function resolvePlanConflict(plan: DataMigrationImportPlan, conflictId: string, resolution: DataMigrationFileConflictResolution): DataMigrationImportPlan { return normalizeResolvedPlan({ ...plan, conflicts: plan.conflicts.map((conflict) => conflict.conflictId === conflictId && allowedConflictResolutions(conflict).includes(resolution) ? { ...conflict, resolution } : conflict) }) }
export function resolveAllPlanConflicts(plan: DataMigrationImportPlan, resolution: DataMigrationFileConflictResolution): DataMigrationImportPlan { return normalizeResolvedPlan({ ...plan, conflicts: plan.conflicts.map((conflict) => allowedConflictResolutions(conflict).includes(resolution) ? { ...conflict, resolution } : conflict) }) }
export function normalizeResolvedPlan(plan: DataMigrationImportPlan): DataMigrationImportPlan { const unresolvedFatalByWorkspace = new Map<string, number>(); for (const conflict of plan.conflicts) if (conflict.fatal && !conflict.resolution) unresolvedFatalByWorkspace.set(conflict.workspaceId, (unresolvedFatalByWorkspace.get(conflict.workspaceId) ?? 0) + 1); return { ...plan, mappings: plan.mappings.map((mapping) => ({ ...mapping, compatible: mapping.strategy === 'skip' || ((mapping.preflightCompatible ?? mapping.compatible) && !unresolvedFatalByWorkspace.has(mapping.workspaceId)), unresolvedIssueCount: plan.conflicts.filter((conflict) => conflict.workspaceId === mapping.workspaceId && !conflict.resolution).length })), fatalIssueCount: [...unresolvedFatalByWorkspace.values()].reduce((sum, count) => sum + count, 0) } }
function allowedConflictResolutions(conflict: DataMigrationConflict): DataMigrationFileConflictResolution[] { if (!conflict.fatal) return ['keep-target', 'import-sibling', 'replace-with-backup', 'skip']; return conflict.renamedPath ? ['skip', 'rename-source'] : ['skip'] }
function canResumeMigrationPhase(phase: DataMigrationProgress['phase']): boolean { return phase === 'staged' || phase === 'committing' || phase === 'verifying' }
export function skippedWorkspaceIdsForStrategies(strategies: Readonly<Record<string, DataMigrationWorkspaceConflictStrategy>>): string[] { return Object.entries(strategies).flatMap(([workspaceId, strategy]) => strategy === 'skip' ? [workspaceId] : []) }
function toggle<T>(values: T[], value: T): T[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value] }
function operationId(kind: string): string { return `${kind}_${globalThis.crypto?.randomUUID?.().replaceAll('-', '') ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}` }
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function capitalize(value: string): string { return `${value.charAt(0).toUpperCase()}${value.slice(1)}` }
