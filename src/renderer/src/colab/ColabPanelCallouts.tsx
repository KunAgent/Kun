import { type ReactElement } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  COLAB_ACCELERATOR_SPECS,
  isColabAcceleratorEligible,
  type ColabAccelerator,
  type ColabConnectionView,
  type ColabSessionView,
  type ColabUntrackedSession
} from '@shared/colab/colab-types'
import { useColabStore } from './colab-store'

const ALTERNATIVE_PREFERENCE: Record<ColabAccelerator, readonly ColabAccelerator[]> = {
  H100: ['G4', 'A100', 'L4', 'T4'],
  A100: ['G4', 'L4', 'T4'],
  G4: ['A100', 'L4', 'T4'],
  L4: ['T4', 'G4', 'A100'],
  T4: ['L4', 'G4', 'A100', 'V5E1'],
  V6E1: ['V5E1', 'L4', 'T4'],
  V5E1: ['T4', 'V6E1'],
  CPU: ['T4', 'V5E1']
}

const primaryBtn = 'rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white'
const dangerBtn = 'rounded-lg bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white'
const quietBtn = 'rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[11px] text-ds-ink'
const warnCard =
  'rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-[11.5px] text-amber-900 dark:text-amber-200'

export function ColabUntrackedCallout({
  untracked,
  wsKey
}: {
  untracked: ColabUntrackedSession
  wsKey: string
}): ReactElement {
  const { t } = useTranslation('common')
  const ref = { connectionId: untracked.connectionId, endpoint: untracked.endpoint }
  return (
    <div className={warnCard}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{t('colab.untrackedTitle')}</div>
          <p className="mt-0.5 leading-relaxed opacity-90">
            {t('colab.untrackedDesc', {
              name: untracked.connectionName,
              accelerator: COLAB_ACCELERATOR_SPECS[untracked.accelerator].fullLabel,
              endpoint: untracked.remoteLabel
            })}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void window.kunGui.colabAdoptUntrackedSession({ ...ref, workspaceRoot: wsKey })}
              className={primaryBtn}
            >
              {t('colab.adoptBtn')}
            </button>
            <button
              type="button"
              onClick={() => void window.kunGui.colabStopUntrackedSession(ref)}
              className={dangerBtn}
            >
              {t('colab.stopBtn')}
            </button>
            <button
              type="button"
              onClick={() => void window.kunGui.colabIgnoreUntrackedSession(ref)}
              className="rounded-lg border border-ds-border bg-ds-card px-2.5 py-1 text-[11px] text-ds-muted"
            >
              {t('colab.ignoreBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ColabSessionCallouts({
  session,
  owningConnection,
  activeConnection
}: {
  session: ColabSessionView | null
  owningConnection: ColabConnectionView | null
  activeConnection: ColabConnectionView | null
}): ReactElement {
  const { t } = useTranslation('common')
  const openRunDialog = useColabStore((s) => s.openRunDialog)
  const openAddAccount = useColabStore((s) => s.openAddAccount)

  // The account that actually needs re-login: the viewed session's owner first, otherwise
  // the workspace's current connection.
  const sessionAuthExpired =
    session !== null &&
    (session.errorKind === 'auth_expired' || owningConnection?.status === 'expired')
  const expiredTarget = sessionAuthExpired
    ? { id: session.connectionId, name: owningConnection?.name ?? session.connectionName }
    : activeConnection?.status === 'expired'
      ? { id: activeConnection.id, name: activeConnection.name }
      : null

  const eligibilityTarget = owningConnection ?? activeConnection
  const alternative = session
    ? (ALTERNATIVE_PREFERENCE[session.accelerator].find((cand) =>
        isColabAcceleratorEligible(eligibilityTarget, cand)
      ) ?? 'CPU')
    : null

  return (
    <>
      {session?.errorKind === 'gpu_unavailable' && alternative ? (
        <div className={warnCard}>
          <div className="font-semibold">
            {t('colab.errGpuUnavailableTitle', {
              accelerator: COLAB_ACCELERATOR_SPECS[session.accelerator].fullLabel
            })}
          </div>
          <p className="mt-0.5 opacity-90">{t('colab.errGpuUnavailableDesc')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => openRunDialog(alternative)} className={primaryBtn}>
              {t('colab.switchToAccelerator', {
                accelerator: COLAB_ACCELERATOR_SPECS[alternative].label,
                rate: COLAB_ACCELERATOR_SPECS[alternative].estimatedCuPerHour
              })}
            </button>
            <button type="button" onClick={() => openRunDialog(session.accelerator)} className={quietBtn}>
              {t('colab.retryLater')}
            </button>
          </div>
        </div>
      ) : null}

      {session?.errorKind === 'not_entitled' && alternative ? (
        <div className={warnCard}>
          <div className="font-semibold">
            {t('colab.errNotEntitledTitle', {
              accelerator: COLAB_ACCELERATOR_SPECS[session.accelerator].fullLabel
            })}
          </div>
          <p className="mt-0.5 opacity-90">{t('colab.errNotEntitledDesc')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => openRunDialog(alternative)} className={primaryBtn}>
              {t('colab.switchToAccelerator', {
                accelerator: COLAB_ACCELERATOR_SPECS[alternative].label,
                rate: COLAB_ACCELERATOR_SPECS[alternative].estimatedCuPerHour
              })}
            </button>
          </div>
        </div>
      ) : null}

      {session &&
      (session.phase === 'disconnected' || session.errorKind === 'disconnected_billing') ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[11.5px] text-amber-900 dark:text-amber-200">
          <div className="font-semibold">{t('colab.errDisconnectedTitle')}</div>
          <p className="mt-0.5 opacity-90">{t('colab.errDisconnectedDesc')}</p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => void window.kunGui.colabReconnectSession({ sessionId: session.id })}
              className={primaryBtn}
            >
              {t('colab.reconnectBtn')}
            </button>
            <button
              type="button"
              onClick={() => void window.kunGui.colabStopSession({ sessionId: session.id })}
              className={dangerBtn}
            >
              {t('colab.stopBtn')}
            </button>
          </div>
        </div>
      ) : null}

      {expiredTarget ? (
        <div className={warnCard}>
          <div className="font-semibold">
            {t('colab.errAuthExpiredTitle', { name: expiredTarget.name })}
          </div>
          <p className="mt-0.5 opacity-90">{t('colab.errAuthExpiredDesc')}</p>
          <button
            type="button"
            onClick={() => openAddAccount(expiredTarget.id)}
            className={`mt-2 ${primaryBtn}`}
          >
            {t('colab.reauthorizeExt')}
          </button>
        </div>
      ) : null}
    </>
  )
}
