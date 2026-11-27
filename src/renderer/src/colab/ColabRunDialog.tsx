import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Lock,
  Play,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  COLAB_ACCELERATORS,
  COLAB_ACCELERATOR_SPECS,
  isColabAcceleratorEligible,
  resolveEligibleColabAccelerator,
  type ColabAccelerator,
  type ColabSyncCandidate
} from '@shared/colab/colab-types'
import {
  formatColabBytes,
  normalizeColabWorkspaceKey,
  selectWorkspaceActiveConnection,
  useColabStore
} from './colab-store'
import { useColabDismiss } from './use-colab-dismiss'

type Props = {
  workspaceRoot: string
  onClose: () => void
}

function isDriveOutputDir(raw: string): boolean {
  const cleaned = raw.trim().replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  return (
    cleaned === 'content/drive' ||
    cleaned.startsWith('content/drive/') ||
    cleaned === 'drive' ||
    cleaned.startsWith('drive/')
  )
}

export function ColabRunDialog({ workspaceRoot, onClose }: Props): ReactElement {
  const { t } = useTranslation('common')
  const snapshot = useColabStore((s) => s.snapshot)
  const accelOverride = useColabStore((s) => s.runDialogAcceleratorOverride)
  const setFocusedSessionId = useColabStore((s) => s.setFocusedSessionId)

  const workspaceConn = selectWorkspaceActiveConnection(snapshot, workspaceRoot)
  const lastRun = snapshot.lastRunsByWorkspace[normalizeColabWorkspaceKey(workspaceRoot)]
  const initialConn =
    workspaceConn?.status === 'expired'
      ? snapshot.connections.find((c) => c.status === 'connected') ?? workspaceConn
      : workspaceConn
  const [selectedConnId, setSelectedConnId] = useState<string>(initialConn?.id ?? '')
  const [alsoSetCurrent, setAlsoSetCurrent] = useState(false)
  const [entryCommand, setEntryCommand] = useState(lastRun?.entryCommand ?? '')
  const [accelerator, setAccelerator] = useState<ColabAccelerator>(
    accelOverride ?? lastRun?.accelerator ?? 'T4'
  )
  const [highMem, setHighMem] = useState<boolean>(Boolean(lastRun?.highMem))
  const [candidates, setCandidates] = useState<ColabSyncCandidate[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [outputRemoteDir, setOutputRemoteDir] = useState('outputs/')
  const [outputLocalDir, setOutputLocalDir] = useState('./outputs')
  const [maxRuntimeHours, setMaxRuntimeHours] = useState(3)
  const [autoStop, setAutoStop] = useState(true)
  const [saveConfig, setSaveConfig] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [mountDrive, setMountDrive] = useState(true)
  const [envVarsText, setEnvVarsText] = useState('')
  const [setupScript, setSetupScript] = useState('')
  const [starting, setStarting] = useState(false)
  const [errorText, setErrorText] = useState<string | null>(null)
  const probedEligibilityRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedConnId && initialConn?.id) {
      setSelectedConnId(initialConn.id)
    }
  }, [selectedConnId, initialConn?.id])

  useColabDismiss(!starting, onClose)

  useEffect(() => {
    if (accelOverride) setAccelerator(accelOverride)
  }, [accelOverride])

  useEffect(() => {
    let cancelled = false
    if (!workspaceRoot || typeof window.kunGui?.colabInspectWorkspaceSync !== 'function') {
      return undefined
    }
    void window.kunGui
      .colabInspectWorkspaceSync({ workspaceRoot })
      .then(({ candidates: list, savedConfig }) => {
        if (cancelled) return
        setCandidates(list)
        if (savedConfig) {
          setEntryCommand(savedConfig.entryCommand)
          if (!accelOverride) setAccelerator(savedConfig.accelerator)
          if (typeof savedConfig.highMem === 'boolean') setHighMem(savedConfig.highMem)
          setSelectedPaths(new Set(savedConfig.syncPaths))
          setOutputRemoteDir(savedConfig.outputRemoteDir)
          setOutputLocalDir(savedConfig.outputLocalDir)
          setMaxRuntimeHours(savedConfig.maxRuntimeHours)
          setAutoStop(savedConfig.autoStop)
          setMountDrive(savedConfig.mountDrive ?? true)
          if (savedConfig.envVars) {
            setEnvVarsText(
              Object.entries(savedConfig.envVars)
                .map(([k, v]) => `${k}=${v}`)
                .join('\n')
            )
          }
          if (savedConfig.setupScript) setSetupScript(savedConfig.setupScript)
        } else {
          setSelectedPaths(new Set(list.filter((c) => c.defaultSelected).map((c) => c.relativePath)))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [accelOverride, workspaceRoot])

  const chosenConn = snapshot.connections.find((c) => c.id === selectedConnId) ?? initialConn
  const chosenConnExpired = chosenConn?.status === 'expired'

  useEffect(() => {
    if (
      !chosenConn ||
      chosenConn.status !== 'connected' ||
      chosenConn.eligibleAccelerators !== undefined ||
      snapshot.cli.state !== 'ready' ||
      probedEligibilityRef.current.has(chosenConn.id) ||
      typeof window.kunGui?.colabRefreshBalances !== 'function'
    ) {
      return
    }
    probedEligibilityRef.current.add(chosenConn.id)
    void window.kunGui.colabRefreshBalances({ connectionId: chosenConn.id })
  }, [chosenConn, snapshot.cli.state])

  const effectiveAccelerator = resolveEligibleColabAccelerator(chosenConn, accelerator)
  const spec = COLAB_ACCELERATOR_SPECS[effectiveAccelerator]
  const totalUploadBytes = useMemo(
    () =>
      candidates
        .filter((c) => selectedPaths.has(c.relativePath))
        .reduce((sum, c) => sum + c.totalBytes, 0),
    [candidates, selectedPaths]
  )
  const hasRequirements = candidates.some(
    (c) => c.isRequirements && selectedPaths.has(c.relativePath)
  )
  const hasLargeDir = candidates.some(
    (c) => c.suggestDriveMount && selectedPaths.has(c.relativePath)
  )
  const maxCu = Number((spec.estimatedCuPerHour * maxRuntimeHours).toFixed(1))

  const richerAltConn = useMemo(() => {
    if (!chosenConn || chosenConn.balanceCu === null || chosenConn.balanceCu >= maxCu) return null
    return (
      snapshot.connections.find(
        (c) =>
          c.id !== chosenConn.id &&
          c.status === 'connected' &&
          c.balanceCu !== null &&
          c.balanceCu > chosenConn.balanceCu!
      ) ?? null
    )
  }, [chosenConn, maxCu, snapshot.connections])

  const submitStart = async (): Promise<void> => {
    if (!chosenConn || chosenConnExpired) return
    setStarting(true)
    setErrorText(null)
    const envVars: Record<string, string> = {}
    for (const line of envVarsText.split(/\r?\n/)) {
      const idx = line.indexOf('=')
      if (idx > 0) {
        const k = line.slice(0, idx).trim()
        const v = line.slice(idx + 1).trim()
        if (k) envVars[k] = v
      }
    }
    try {
      const res = await window.kunGui.colabStartRun({
        workspaceRoot,
        connectionId: chosenConn.id,
        setAsWorkspaceCurrent: alsoSetCurrent,
        entryCommand: entryCommand.trim(),
        accelerator: effectiveAccelerator,
        highMem: Boolean(highMem && spec.supportsHighMem),
        syncPaths: [...selectedPaths],
        outputRemoteDir: outputRemoteDir.trim() || 'outputs/',
        outputLocalDir: outputLocalDir.trim() || './outputs',
        maxRuntimeHours,
        autoStop,
        saveWorkspaceConfig: saveConfig,
        mountDrive,
        ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
        ...(setupScript.trim() ? { setupScript: setupScript.trim() } : {})
      })
      if (!res.ok) {
        setErrorText(res.message)
        return
      }
      setFocusedSessionId(res.session.id)
      onClose()
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  return createPortal(
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('colab.dialogTitle')}
    >
      <div className="flex max-h-[88vh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-ds-border bg-ds-card text-ds-ink shadow-2xl">
        <header className="flex items-center justify-between border-b border-ds-border px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{t('colab.dialogTitle')}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('colab.cancelBtn')}
            className="rounded-lg p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[12.5px]">
          {/* Entry command */}
          <div>
            <label className="block text-[11.5px] font-medium text-ds-muted">
              {t('colab.entryCommandLabel')}
            </label>
            <input
              type="text"
              value={entryCommand}
              autoFocus
              placeholder="python train.py"
              onChange={(e) => setEntryCommand(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ds-border bg-ds-subtle px-3 py-2 font-mono text-[12px] text-ds-ink focus:border-accent focus:outline-none"
            />
          </div>

          {/* Connection Picker */}
          <div>
            <label className="block text-[11.5px] font-medium text-ds-muted">
              {t('colab.connectionFieldLabel')}
            </label>
            <select
              value={chosenConn?.id ?? ''}
              onChange={(e) => setSelectedConnId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-ds-border bg-ds-subtle px-3 py-2 text-[12.5px] text-ds-ink focus:border-accent focus:outline-none"
            >
              {snapshot.connections.map((c) => (
                <option key={c.id} value={c.id} disabled={c.status === 'expired'}>
                  {c.name} · {c.email}
                  {c.status === 'expired'
                    ? ` (${t('colab.expiredBadge')})`
                    : c.balanceCu !== null
                      ? ` (${c.balanceCu} CU)`
                      : ''}
                  {c.id === workspaceConn?.id ? ` · ${t('colab.currentConnection')}` : ''}
                </option>
              ))}
            </select>
            {chosenConn && workspaceConn && chosenConn.id !== workspaceConn.id ? (
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[11.5px] text-ds-muted">
                <input
                  type="checkbox"
                  checked={alsoSetCurrent}
                  onChange={(e) => setAlsoSetCurrent(e.target.checked)}
                />
                <span>{t('colab.alsoSetWorkspaceCurrent')}</span>
              </label>
            ) : null}
          </div>

          {/* Accelerator selector */}
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="block text-[11.5px] font-medium text-ds-muted">
                {t('colab.acceleratorLabel')}
              </label>
              {spec.supportsHighMem ? (
                <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ds-ink">
                  <input
                    type="checkbox"
                    checked={highMem}
                    onChange={(e) => setHighMem(e.target.checked)}
                    className="accent-accent"
                  />
                  <span>{t('colab.highMemCheckbox')}</span>
                </label>
              ) : (
                <span className="rounded bg-ds-subtle px-1.5 py-0.5 text-[10.5px] text-ds-muted">
                  {t('colabNb.highMemBuiltinHint')}
                </span>
              )}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-2">
              {COLAB_ACCELERATORS.map((acc) => {
                const item = COLAB_ACCELERATOR_SPECS[acc]
                const eligible = isColabAcceleratorEligible(chosenConn, acc)
                const active = effectiveAccelerator === acc
                const ineligibleReason = !eligible
                  ? t(
                      item.tierRequirement === 'ai_ultra'
                        ? 'colabNb.ineligibleAiUltra'
                        : 'colabNb.ineligibleTier',
                      { gpu: item.fullLabel }
                    )
                  : undefined
                return (
                  <button
                    key={acc}
                    type="button"
                    disabled={!eligible}
                    title={ineligibleReason}
                    onClick={() => setAccelerator(acc)}
                    className={`rounded-xl border p-2.5 text-left transition ${
                      active
                        ? 'border-accent bg-accent/10'
                        : !eligible
                          ? 'cursor-not-allowed border-ds-border/60 bg-ds-subtle/50 opacity-45'
                          : 'border-ds-border bg-ds-subtle hover:border-ds-faint'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 text-[13px] font-bold text-ds-ink">
                      <span>{item.label}</span>
                      {!eligible ? (
                        <Lock className="h-3 w-3 shrink-0 text-ds-muted" aria-hidden="true" />
                      ) : null}
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-ds-muted">
                      {item.vramGb
                        ? t('colab.vramLabel', { gb: item.vramGb })
                        : item.tpuHbmGb
                          ? t('colab.tpuHbmLabel', { gb: item.tpuHbmGb })
                          : t('colab.cpuRamLabel', { gb: item.ramGb })}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] text-accent">
                      ~{item.estimatedCuPerHour} CU/h
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Sync Workspace Files */}
          {candidates.length > 0 ? (
            <div>
              <label className="block text-[11.5px] font-medium text-ds-muted">
                {t('colab.syncFilesLabel')}
              </label>
              <div className="mt-1.5 max-h-32 space-y-1 overflow-y-auto rounded-xl border border-ds-border bg-ds-subtle p-2">
                {candidates.map((cand) => {
                  const checked = selectedPaths.has(cand.relativePath)
                  return (
                    <label
                      key={cand.relativePath}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1 text-[12px] hover:bg-ds-hover"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setSelectedPaths((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(cand.relativePath)
                              else next.delete(cand.relativePath)
                              return next
                            })
                          }}
                        />
                        <span className="truncate font-mono text-ds-ink">{cand.label}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ds-faint">
                        {formatColabBytes(cand.totalBytes)}
                      </span>
                    </label>
                  )
                })}
              </div>
              {hasRequirements ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                  <Info className="h-3 w-3 shrink-0" />
                  <span>{t('colab.requirementsAutoHint')}</span>
                </p>
              ) : null}
              {hasLargeDir ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3 shrink-0" />
                  <span>{t('colabNb.uploadColabHint')}</span>
                </p>
              ) : null}
            </div>
          ) : null}

          {/* Output mapping & Max runtime */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-1.5">
                <label className="block text-[11.5px] font-medium text-ds-muted">
                  {t('colab.outputMappingLabel')}
                </label>
                {mountDrive && !isDriveOutputDir(outputRemoteDir) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMountDrive(true)
                      setOutputRemoteDir('/content/drive/MyDrive/checkpoints')
                    }}
                    className="text-[10.5px] font-medium text-accent hover:underline"
                  >
                    {t('colab.useDriveCheckpointsBtn')}
                  </button>
                ) : null}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  type="text"
                  value={outputRemoteDir}
                  onChange={(e) => setOutputRemoteDir(e.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-subtle px-2.5 py-1.5 font-mono text-[11.5px]"
                />
                {mountDrive && isDriveOutputDir(outputRemoteDir) ? null : (
                  <>
                    <span className="text-ds-faint">→</span>
                    <input
                      type="text"
                      value={outputLocalDir}
                      onChange={(e) => setOutputLocalDir(e.target.value)}
                      className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-subtle px-2.5 py-1.5 font-mono text-[11.5px]"
                    />
                  </>
                )}
              </div>
            </div>
            <div>
              <label className="block text-[11.5px] font-medium text-ds-muted">
                {t('colab.maxRuntimeLabel')}
              </label>
              <select
                value={maxRuntimeHours}
                onChange={(e) => setMaxRuntimeHours(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-ds-border bg-ds-subtle px-2.5 py-1.5 text-[12px]"
              >
                {[1, 3, 6, 12, 24].map((h) => (
                  <option key={h} value={h}>
                    {t('colab.hoursOption', { hours: h })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {mountDrive && isDriveOutputDir(outputRemoteDir) ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
              {t('colab.driveOutputPersistedHint')}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ds-ink">
              <input
                type="checkbox"
                checked={mountDrive}
                onChange={(e) => setMountDrive(e.target.checked)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block">{t('colab.mountDriveCheckbox')}</span>
                <span className="block text-[11px] text-ds-muted">{t('colab.mountDriveDesc')}</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ds-ink">
              <input
                type="checkbox"
                checked={autoStop}
                onChange={(e) => setAutoStop(e.target.checked)}
              />
              <span>{t('colab.autoStopCheckbox')}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ds-muted">
              <input
                type="checkbox"
                checked={saveConfig}
                onChange={(e) => setSaveConfig(e.target.checked)}
              />
              <span>{t('colab.saveConfigCheckbox')}</span>
            </label>
          </div>

          {/* Collapsible Advanced */}
          <div className="border-t border-ds-border-muted pt-2.5">
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ds-muted hover:text-ds-ink"
            >
              {advancedOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span>{t('colab.advancedToggle')}</span>
            </button>
            {advancedOpen ? (
              <div className="mt-2.5 space-y-2.5">
                <div>
                  <label className="block text-[11px] text-ds-muted">
                    {t('colab.envVarsLabel')}
                  </label>
                  <textarea
                    rows={2}
                    value={envVarsText}
                    onChange={(e) => setEnvVarsText(e.target.value)}
                    placeholder="WANDB_API_KEY=..."
                    className="mt-1 w-full rounded-xl border border-ds-border bg-ds-subtle px-2.5 py-1.5 font-mono text-[11.5px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-ds-muted">
                    {t('colab.setupScriptLabel')}
                  </label>
                  <input
                    type="text"
                    value={setupScript}
                    onChange={(e) => setSetupScript(e.target.value)}
                    placeholder="pip install accelerate"
                    className="mt-1 w-full rounded-xl border border-ds-border bg-ds-subtle px-2.5 py-1.5 font-mono text-[11.5px]"
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Pre-flight summary & low-balance alternative suggestion */}
          <div className="rounded-xl border border-ds-border-muted bg-ds-subtle p-3 text-[11.5px] text-ds-muted">
            <div>
              {t('colab.preflightEstimate', {
                size: formatColabBytes(totalUploadBytes),
                maxCu,
                balance: chosenConn?.balanceCu ?? '--'
              })}
            </div>
            {richerAltConn ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
                <span>
                  {t('colab.lowBalanceAltHint', {
                    altName: richerAltConn.name,
                    altBalance: richerAltConn.balanceCu ?? 0
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedConnId(richerAltConn.id)}
                  className="rounded-md bg-amber-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-amber-700"
                >
                  {t('colab.useAltConnection', { altName: richerAltConn.name })}
                </button>
              </div>
            ) : null}
          </div>
          {errorText ? <p className="text-[11.5px] text-red-500">{errorText}</p> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-ds-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-3.5 py-1.5 text-[12.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          >
            {t('colab.cancelBtn')}
          </button>
          <button
            type="button"
            disabled={starting || !entryCommand.trim() || !chosenConn || chosenConnExpired}
            onClick={() => void submitStart()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-1.5 text-[12.5px] font-semibold text-white shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            {starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
            <span>{starting ? t('colab.startingBtn') : t('colab.startRunBtn')}</span>
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
