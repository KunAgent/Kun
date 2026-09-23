import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { MobileSheet } from '../sheets/MobileSheet'
import './mobile-code-options.css'

/**
 * Minimal Remote/mobile settings sheet. The desktop settings route is not
 * reachable from the phone shell, so the essentials — runtime health and the
 * default model — live here; everything else points at the desktop app.
 */
export function MobileCodeSettings({ open, onClose }: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('common')
  const state = useChatStore(useShallow((value) => ({
    runtimeConnection: value.runtimeConnection,
    composerModel: value.composerModel,
    composerProviderId: value.composerProviderId,
    composerPickList: value.composerPickList,
    composerModelGroups: value.composerModelGroups,
    setComposerModel: value.setComposerModel,
    workspaceRoot: value.workspaceRoot
  })))
  const providerForModel = (value: string): string =>
    state.composerModelGroups.find((group) => group.modelIds.includes(value))?.providerId ?? ''
  const runtimeLabel = state.runtimeConnection === 'ready' ? t('mobileRuntime_ready')
    : state.runtimeConnection === 'checking' ? t('mobileRuntime_checking')
    : state.runtimeConnection === 'offline' ? t('mobileRuntime_offline')
    : t('mobileRuntime_idle')

  return <MobileSheet open={open} title={t('settings')} closeLabel={t('close')} onClose={onClose}>
    <div className="kun-mobile-code-options">
      <dl>
        <dt>{t('mobileRuntimeStatus')}</dt><dd>{runtimeLabel}</dd>
        <dt>{t('mobileDetailsProject')}</dt><dd>{state.workspaceRoot || '—'}</dd>
      </dl>
      <label>{t('composerModel')}
        <select value={state.composerModel}
          onChange={(event) => state.setComposerModel(event.target.value, providerForModel(event.target.value))}>
          {!state.composerModel ? <option value="">{t('autoLabel')}</option> : null}
          {state.composerPickList.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      {state.composerProviderId ? <p>{state.composerProviderId}</p> : null}
      <p>{t('mobileSettingsDesktopHint')}</p>
    </div>
  </MobileSheet>
}
