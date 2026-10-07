import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { AgentIcon } from '../agent-icon'
import { setupLoginCommand } from '../ade/agent-center-actions'
import { useAgentEnablement } from '../ade/use-agent-enablement'
import { shortAgentVersion, type OnboardingAgentStatus } from './onboarding-agents'

const PHASE_PROGRESS = { preparing: '18%', checking: '62%', activating: '92%' } as const

export function OnboardingAgentCard({ row, settings, status, platform, active, queued, index, patch, beforeCheck, onConnect, onCancel, onSettled }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  status: OnboardingAgentStatus
  platform: string
  /** This card owns the single readiness-check slot. */
  active: boolean
  queued: boolean
  index: number
  patch: (patch: Partial<KunHarnessSettingsV1>) => void
  beforeCheck: () => Promise<boolean>
  onConnect: () => void
  onCancel: () => void
  onSettled: () => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const gate = useAgentEnablement({ row, settings, patch, beforeCheck })
  const startedRef = useRef(false)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const [copied, setCopied] = useState(false)
  const name = row.definition.displayName

  useEffect(() => {
    if (!active || startedRef.current) return
    startedRef.current = true
    void gate.enable().finally(() => {
      startedRef.current = false
      settledRef.current()
    })
    // The slot is granted once per activation; the gate itself guards re-entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const login = row.definition.builtin
    ? setupLoginCommand(row.definition.setup, row.status.installed === 'yes' ? row.status.resolvedCommand : undefined, platform)
    : null
  const state = gate.checking ? 'checking' : gate.error ? 'failed' : queued ? 'queued'
    : status === 'connected' ? 'connected' : status
  const errorText = gate.error ? (gate.error.startsWith('agentEnablement.') ? tc(gate.error) : gate.error) : ''

  const copyLogin = (): void => {
    if (!login) return
    void navigator.clipboard?.writeText(login.command).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }).catch(() => undefined)
  }

  const statusLine = (): ReactElement => {
    if (state === 'checking') {
      return <><i className="kun-onb-dot" data-tone="running" />{tc(`agentEnablement.phases.${gate.phase}`)}</>
    }
    if (state === 'failed') return <><i className="kun-onb-dot" data-tone="danger" />{errorText}</>
    if (state === 'queued') return <><i className="kun-onb-dot" />{t('onboarding.agents.status.queued')}</>
    if (state === 'connected') return <><i className="kun-onb-dot" data-tone="success" />{t('onboarding.agents.status.connected')}</>
    if (state === 'login') return <><i className="kun-onb-dot" data-tone="warning" />{t('onboarding.agents.status.login')}</>
    if (state === 'outdated') return <><i className="kun-onb-dot" data-tone="warning" />{t('onboarding.agents.status.outdated')}</>
    if (state === 'unavailable') return <><i className="kun-onb-dot" data-tone="warning" />{t('onboarding.agents.status.unavailable')}</>
    if (state === 'detecting') return <><i className="kun-onb-dot" data-tone="running" />{t('onboarding.agents.status.detecting')}</>
    return <><i className="kun-onb-dot" />{t('onboarding.agents.status.ready')}</>
  }

  return (
    <div
      className="kun-onb-agent"
      data-state={state}
      data-onboarding-agent={row.definition.id}
      style={{ animationDelay: `${0.12 + index * 0.06}s` }}
    >
      <span className="kun-onb-agent-tile">
        <AgentIcon harnessId={row.definition.id} size={22} />
        {state === 'connected' ? (
          <span className="kun-onb-agent-badge"><Check size={9} strokeWidth={4} aria-hidden="true" /></span>
        ) : null}
      </span>
      <span className="kun-onb-agent-text">
        <span className="kun-onb-agent-name" title={name}>
          <span className="kun-onb-agent-label">{name}</span>
          {row.status.version ? <small title={row.status.version}>v{shortAgentVersion(row.status.version)}</small> : null}
        </span>
        <span
          className="kun-onb-agent-status"
          title={state === 'failed' ? gate.errorDetail || errorText : state === 'login' ? login?.command : undefined}
        >{statusLine()}</span>
      </span>
      {state === 'ready' ? (
        <button type="button" className="kun-onb-connect" aria-label={t('onboarding.agents.connectLabel', { name })} onClick={onConnect} data-onboarding-agent-connect>
          {t('onboarding.agents.connect')}
        </button>
      ) : null}
      {state === 'failed' ? (
        <button type="button" className="kun-onb-connect" onClick={onConnect}>{t('onboarding.agents.retry')}</button>
      ) : null}
      {state === 'queued' ? (
        <>
          <span className="kun-onb-state" data-tone="muted">{t('onboarding.agents.queued')}</span>
          <button type="button" className="kun-onb-x" aria-label={t('onboarding.agents.cancelLabel', { name })} onClick={onCancel}>
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </>
      ) : null}
      {state === 'checking' ? (
        <>
          <button type="button" className="kun-onb-x" aria-label={t('onboarding.agents.cancelLabel', { name })} onClick={gate.cancel}>
            <X size={13} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <span className="kun-onb-state" data-tone="running"><span className="kun-onb-spin" />{t('onboarding.agents.checking')}</span>
          <span className="kun-onb-agent-progress" style={{ width: PHASE_PROGRESS[gate.phase] }} />
        </>
      ) : null}
      {state === 'connected' ? (
        <>
          <button type="button" className="kun-onb-unlink" onClick={gate.disable}>{t('onboarding.agents.disconnect')}</button>
          <span className="kun-onb-state" data-tone="success">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            {t('onboarding.agents.connected')}
          </span>
        </>
      ) : null}
      {state === 'login' && login ? (
        <button type="button" className="kun-onb-btn" onClick={copyLogin}>
          {copied ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : <Copy size={13} strokeWidth={2} aria-hidden="true" />}
          {t(copied ? 'onboarding.agents.copied' : 'onboarding.agents.copyCommand')}
        </button>
      ) : null}
    </div>
  )
}
