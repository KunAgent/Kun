import { useMemo, type ReactElement } from 'react'
import { ArrowLeftRight, AtSign, ChevronRight, Globe, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunToolPermissionMode } from '@shared/app-settings'
import { AgentIcon } from '../agent-icon'
import { PERMISSION_OPTIONS } from '../initial-setup-dialog-support'
import { OnboardingProviderGlyph, onboardingProviderTint } from './OnboardingModelPicker'
import type { OnboardingStep } from './onboarding-steps'

const CONFETTI_COLORS = ['#5b78ff', '#85c1f1', '#f47464', '#f0a23f', '#f2c94c', '#34c38f', '#a89bf5']

type ConfettiPiece = { round: boolean; style: Record<string, string> }

/** Deterministic pieces so a re-render never reshuffles the burst. */
function confettiPieces(count = 30): ConfettiPiece[] {
  let seed = 7
  const random = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  return Array.from({ length: count }, (_, index) => ({
    round: index % 4 === 0,
    style: {
      left: `${(6 + random() * 88).toFixed(1)}%`,
      background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      '--dx': `${Math.round((random() - 0.5) * 160)}px`,
      '--dy': `${Math.round(260 + random() * 220)}px`,
      '--rot': `${Math.round(200 + random() * 520) * (random() > 0.5 ? 1 : -1)}deg`,
      animationDelay: `${(random() * 0.6).toFixed(2)}s`
    }
  }))
}

export function OnboardingConfetti(): ReactElement {
  const pieces = useMemo(() => confettiPieces(), [])
  return (
    <div className="kun-onb-confetti" aria-hidden="true">
      {pieces.map((piece, index) => (
        <i key={index} className={piece.round ? 'is-round' : undefined} style={piece.style} />
      ))}
    </div>
  )
}

export function OnboardingReadyStep({ provider, permissionMode, agents, localeLabel, themeLabel, onEdit }: {
  provider: { presetId: string | null; name: string; model: string }
  permissionMode: KunToolPermissionMode
  agents: ReadonlyArray<{ id: string; name: string }>
  localeLabel: string
  themeLabel: string
  onEdit: (step: OnboardingStep) => void
}): ReactElement {
  const { t } = useTranslation('settings')
  const permission = PERMISSION_OPTIONS.find((option) => option.value === permissionMode) ?? PERMISSION_OPTIONS[0]
  const PermissionIcon = permission.Icon
  const edit = (
    <span className="kun-onb-summary-edit">{t('onboarding.ready.edit')}<ChevronRight size={13} strokeWidth={2.2} aria-hidden="true" /></span>
  )
  return (
    <>
      <div className="kun-onb-summary">
        <button type="button" className="kun-onb-summary-row" onClick={() => onEdit('model')} data-onboarding-summary="model">
          <span className="kun-onb-provider-icon kun-onb-summary-icon" data-tint={provider.presetId ? onboardingProviderTint(provider.presetId) : undefined}>
            {provider.presetId ? <OnboardingProviderGlyph entry={{ presetId: provider.presetId }} /> : <Globe size={17} strokeWidth={1.8} aria-hidden="true" />}
          </span>
          <span className="kun-onb-summary-key">{t('onboarding.ready.model')}</span>
          <span className="kun-onb-summary-value">{provider.name}{provider.model ? <small>{provider.model}</small> : null}</span>
          {edit}
        </button>
        <button type="button" className="kun-onb-summary-row" onClick={() => onEdit('permission')} data-onboarding-summary="permission">
          <span className="kun-onb-perm-icon kun-onb-summary-icon" data-tone={permission.tone}>
            <PermissionIcon size={17} strokeWidth={1.8} aria-hidden="true" />
          </span>
          <span className="kun-onb-summary-key">{t('onboarding.ready.permission')}</span>
          <span className="kun-onb-summary-value">{t(permission.labelKey)}</span>
          {edit}
        </button>
        <button type="button" className="kun-onb-summary-row" onClick={() => onEdit('agents')} data-onboarding-summary="agents">
          <span className="kun-onb-avatars" aria-hidden="true">
            <span><AgentIcon harnessId="kun" size={14} /></span>
            {agents.slice(0, 3).map((agent) => (
              <span key={agent.id}><AgentIcon harnessId={agent.id} size={15} /></span>
            ))}
          </span>
          <span className="kun-onb-summary-key">{t('onboarding.ready.agents')}</span>
          <span className="kun-onb-summary-value">
            {agents.length ? ['Kun', ...agents.map((agent) => agent.name)].join(t('onboarding.ready.listSeparator')) : t('onboarding.ready.agentsNone')}
          </span>
          {edit}
        </button>
        <button type="button" className="kun-onb-summary-row" onClick={() => onEdit('welcome')} data-onboarding-summary="welcome">
          <span className="kun-onb-summary-icon"><Globe size={17} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="kun-onb-summary-key">{t('onboarding.ready.appearance')}</span>
          <span className="kun-onb-summary-value">{localeLabel}<small>{themeLabel}</small></span>
          {edit}
        </button>
      </div>

      <div className="kun-onb-tips">
        <div className="kun-onb-tip">
          <span className="kun-onb-tip-icon"><ArrowLeftRight size={15} strokeWidth={2} aria-hidden="true" /></span>
          <b>{t('onboarding.ready.tipSwitchTitle')}</b>
          <span>{t('onboarding.ready.tipSwitchBody')}</span>
        </div>
        <div className="kun-onb-tip">
          <span className="kun-onb-tip-icon"><AtSign size={15} strokeWidth={2} aria-hidden="true" /></span>
          <b>{t('onboarding.ready.tipMentionTitle')}</b>
          <span>{t('onboarding.ready.tipMentionBody')}</span>
        </div>
        <div className="kun-onb-tip">
          <span className="kun-onb-tip-icon"><LayoutGrid size={15} strokeWidth={2} aria-hidden="true" /></span>
          <b>{t('onboarding.ready.tipAgentsTitle')}</b>
          <span>{t('onboarding.ready.tipAgentsBody')}</span>
        </div>
      </div>
    </>
  )
}
