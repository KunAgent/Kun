import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { UserRound, X } from 'lucide-react'
import { harnessProfileReady, readyHarnessProfiles } from '@shared/harness-enablement'
import type { AdeHarnessCredentialMode, AdeHarnessRow } from '@shared/ade-harnesses'
import {
  harnessRowAvailable,
  harnessRowRunsTurns,
  harnessRowUnavailableCode,
  harnessUnavailableLabelKey,
  loadHarnessModels,
  loadHarnessProviderGroups,
  loadHarnesses,
  useHarnessStore
} from '../../store/harness-store'
import type { SettingsRouteSection } from '../../store/chat-store-types'
import { AgentIcon } from '../agent-icon'
import { useHarnessDefaults } from '../../lib/harness-defaults'
import {
  readAdeLastOneOnOnePick,
  resolveOneOnOnePick,
  writeAdeLastOneOnOnePick,
  type AdeOneOnOnePick
} from './ade-one-on-one-pick'

export type AdeOneOnOneSelection = {
  harnessId: string
  credentialMode?: AdeHarnessCredentialMode
  providerId?: string
  model?: string
  isolation?: 'local' | 'worktree'
  permissionMode?: string
}

const CREDENTIAL_LABEL: Record<AdeHarnessCredentialMode, string> = {
  'native-login': 'adeCredential.nativeLogin',
  provider: 'adeCredential.provider',
  'kun-gateway': 'adeCredential.kunGateway'
}

const fieldClass =
  'w-full rounded-lg border border-ds-border-muted bg-ds-main px-2.5 py-1.5 text-[13px] text-ds-ink outline-none focus:border-accent-tint/50'

/**
 * P4-15: one-to-one session dialog (replaces the sidebar inline list). Pick an
 * agent, then the credential path (native sign-in or Kun gateway/provider with
 * a concrete provider), then model and isolation. Initial values come from the
 * remembered last pick, then `agents.kun.harnesses.defaults` (P4-11).
 */
export function AdeOneOnOneDialog({
  onConfirm,
  onOpenSettings,
  onClose
}: {
  onConfirm: (selection: AdeOneOnOneSelection) => void
  onOpenSettings: (section?: SettingsRouteSection) => void
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const rows = useHarnessStore((s) => s.rows).filter((entry) => harnessRowRunsTurns(entry) && harnessRowAvailable(entry))
  const rowsLoaded = useHarnessStore((s) => s.rowsLoadedAt !== undefined)
  const rowsLoading = useHarnessStore((s) => s.rowsLoading)
  const harnessDefaults = useHarnessDefaults()

  const [harnessId, setHarnessId] = useState('')
  const [credentialMode, setCredentialMode] = useState('')
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [isolation, setIsolation] = useState<'local' | 'worktree'>('local')

  useEffect(() => {
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])

  const row = rows.find((entry) => entry.definition.id === harnessId)

  // Remembered pick wins while its harness is still selectable; otherwise the
  // first available turn-capable row, else the first row for display.
  useEffect(() => {
    if (!rowsLoaded || rows.length === 0 || harnessId) return
    const last = readAdeLastOneOnOnePick()
    const lastRow = last
      ? rows.find((entry) => entry.definition.id === last.harnessId && harnessRowAvailable(entry))
      : undefined
    const first = rows.find(harnessRowAvailable) ?? rows[0]
    applyHarness(
      lastRow?.definition.id ?? first?.definition.id ?? '',
      lastRow ? last ?? undefined : undefined
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsLoaded, rows, harnessId])

  const applyHarness = (nextId: string, hint?: AdeOneOnOnePick): void => {
    const resolved = resolveOneOnOnePick({
      row: rows.find((entry) => entry.definition.id === nextId),
      defaults: harnessDefaults[nextId],
      hint
    })
    const nextRow = rows.find((entry) => entry.definition.id === nextId)
    const readyProfiles = nextRow ? readyHarnessProfiles(nextRow) : []
    const profile = readyProfiles.find((entry) => entry.credentialMode === resolved.credentialMode &&
      (entry.providerId ?? '') === resolved.providerId) ?? readyProfiles[0]
    setHarnessId(nextId)
    setCredentialMode(profile?.credentialMode ?? resolved.credentialMode)
    setProviderId(profile?.providerId ?? (nextId === 'kun' ? resolved.providerId : ''))
    setModel(resolved.model)
    setIsolation(resolved.isolation)
  }

  const needsProviders =
    row !== undefined &&
    row.definition.credentialModes.some((mode) => mode !== 'native-login')
  useEffect(() => {
    if (!harnessId) return
    void loadHarnessModels(harnessId)
    if (needsProviders) void loadHarnessProviderGroups(harnessId)
  }, [harnessId, needsProviders])

  const modelCache = useHarnessStore((s) => (harnessId ? s.models[harnessId] : undefined))
  const providerGroups = useHarnessStore((s) =>
    harnessId ? s.providerGroups[harnessId]?.groups : undefined
  )
  const groupsWithModels = useMemo(
    () => (providerGroups ?? []).filter((group) => group.models.length > 0 && (row?.definition.id === 'kun' || Boolean(row &&
      readyHarnessProfiles(row).some((profile) => profile.providerId === group.providerId && profile.credentialMode !== 'native-login')))),
    [providerGroups, row]
  )

  // Credential modes the dialog offers: provider-routed modes need at least
  // one exposable provider group or the pick would be unstartable.
  const credentialOptions = useMemo(
    () =>
      (row?.definition.credentialModes ?? []).filter(
        (mode) => row?.definition.id === 'kun' || Boolean(row && readyHarnessProfiles(row).some((entry) => entry.credentialMode === mode))
      ),
    [row]
  )
  const resolvedCred = credentialOptions.includes(credentialMode as AdeHarnessCredentialMode)
    ? credentialMode
    : credentialOptions[0] ?? ''
  const resolvedProviderId =
    resolvedCred === 'native-login'
      ? (row ? readyHarnessProfiles(row).find((entry) => entry.credentialMode === 'native-login' && (entry.providerId ?? '') === providerId)?.providerId
        ?? readyHarnessProfiles(row).find((entry) => entry.credentialMode === 'native-login')?.providerId ?? '' : '')
      : groupsWithModels.some((group) => group.providerId === providerId)
        ? providerId
        : groupsWithModels[0]?.providerId ?? ''
  const modelOptions =
    resolvedCred === 'native-login'
      ? (modelCache?.models ?? row?.definition.staticModels ?? [])
      : groupsWithModels.find((group) => group.providerId === resolvedProviderId)?.models ?? []
  const resolvedModel = modelOptions.includes(model) ? model : modelOptions[0] ?? ''

  const confirm = (): void => {
    if (!row || !harnessProfileReady(row, { harnessId, credentialMode: resolvedCred as AdeHarnessCredentialMode, providerId: resolvedProviderId || undefined })) return
    const defaults = harnessDefaults[harnessId]
    const selection: AdeOneOnOneSelection = {
      harnessId,
      credentialMode: (resolvedCred || undefined) as AdeHarnessCredentialMode | undefined,
      providerId: resolvedProviderId || undefined,
      model: resolvedModel || undefined,
      isolation,
      ...(defaults?.permissionMode ? { permissionMode: defaults.permissionMode } : {})
    }
    writeAdeLastOneOnOnePick({
      harnessId,
      credentialMode: selection.credentialMode,
      providerId: selection.providerId,
      model: selection.model,
      isolation
    })
    onConfirm(selection)
    onClose()
  }

  // Portal to body: the sidebar's glass surface creates a containing block
  // (backdrop-filter), which would clip a `fixed` overlay to the sidebar.
  return createPortal(
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-label={t('adeNewOneOnOne')}
        data-ade-one-on-one-dialog
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col rounded-[24px] border border-ds-border bg-ds-card shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ds-ink">
            <UserRound className="h-4 w-4 text-accent" strokeWidth={1.9} />
            {t('adeOneOnOneDialog.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('cancel')}
            className="rounded-full p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-5 pb-2">
          <p className="mb-1.5 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
            {t('adeOneOnOneDialog.agent')}
          </p>
          <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl border border-ds-border-muted bg-ds-main/60 p-1">
            {!rowsLoaded || rowsLoading ? (
              <p className="px-2 py-1.5 text-[12px] text-ds-faint">{t('adeAgentPickerLoading')}</p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-1.5 text-[12px] text-ds-faint">{t('adeAgentPickerEmpty')}</p>
            ) : (
              rows.map((entry) => {
                const id = entry.definition.id
                const unavailable = harnessRowUnavailableCode(entry)
                const selected = id === harnessId
                return (
                  <button
                    key={id}
                    type="button"
                    data-ade-one-on-one-agent={id}
                    disabled={unavailable !== null}
                    onClick={() => applyHarness(id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition ${
                      selected
                        ? 'bg-accent/12 text-ds-ink'
                        : unavailable
                          ? 'text-ds-faint'
                          : 'text-ds-text hover:bg-ds-hover'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate">
                      <AgentIcon harnessId={id} size={16} />
                      <span className="truncate">{entry.definition.displayName}</span>
                    </span>
                    {unavailable ? (
                      <span className="shrink-0 text-[11px] text-ds-faint">
                        {t(harnessUnavailableLabelKey(unavailable))}
                      </span>
                    ) : selected ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
          {rows.some((entry) => harnessRowUnavailableCode(entry) !== null) ? (
            <button
              type="button"
              className="mt-1 text-[11px] text-ds-accent hover:underline"
              onClick={() => {
                onClose()
                onOpenSettings('agentsHarnesses')
              }}
            >
              {t('adeHarnessOpenSettings')}
            </button>
          ) : null}

          {credentialOptions.length > 1 ? (
            <>
              <p className="mb-1.5 mt-3 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
                {t('adeOneOnOneDialog.credential')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {credentialOptions.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-ade-one-on-one-credential={mode}
                    onClick={() => {
                      setCredentialMode(mode)
                      setProviderId('')
                      setModel('')
                    }}
                    className={`rounded-full border px-2.5 py-1 text-[12px] transition ${
                      mode === resolvedCred
                        ? 'border-accent-tint/60 bg-accent/10 text-ds-ink'
                        : 'border-ds-border-muted text-ds-muted hover:bg-ds-hover'
                    }`}
                  >
                    {t(CREDENTIAL_LABEL[mode])}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {resolvedCred && resolvedCred !== 'native-login' ? (
            <>
              <p className="mb-1.5 mt-3 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
                {t('adeOneOnOneDialog.provider')}
              </p>
              <select
                className={fieldClass}
                data-ade-one-on-one-provider
                value={resolvedProviderId}
                onChange={(event) => {
                  setProviderId(event.target.value)
                  setModel('')
                }}
              >
                {groupsWithModels.map((group) => (
                  <option key={group.providerId} value={group.providerId}>
                    {group.label}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          {row && modelOptions.length > 0 ? (
            <>
              <p className="mb-1.5 mt-3 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
                {t('adeOneOnOneDialog.model')}
              </p>
              <select
                className={fieldClass}
                data-ade-one-on-one-model
                value={resolvedModel}
                onChange={(event) => setModel(event.target.value)}
              >
                {modelOptions.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <p className="mb-1.5 mt-3 text-[11.5px] font-medium uppercase tracking-wide text-ds-faint">
            {t('adeIsolation.title')}
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {(['local', 'worktree'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                data-ade-one-on-one-isolation={mode}
                onClick={() => setIsolation(mode)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  mode === isolation
                    ? 'border-accent-tint/60 bg-accent/10'
                    : 'border-ds-border-muted hover:bg-ds-hover'
                }`}
              >
                <span className="block text-[12.5px] font-medium text-ds-ink">
                  {t(mode === 'local' ? 'adeIsolation.local' : 'adeIsolation.worktree')}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-ds-faint">
                  {t(mode === 'local' ? 'adeIsolation.localHint' : 'adeIsolation.worktreeHint')}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-full px-4 text-[12.5px] text-ds-muted hover:bg-ds-hover"
          >
            {t('cancel')}
          </button>
          <button
            type="button"
            data-ade-one-on-one-start
            disabled={!harnessId}
            onClick={confirm}
            className="inline-flex h-8 items-center rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {t('adeOneOnOneDialog.start')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
