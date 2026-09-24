import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { MobileSheet } from '../sheets/MobileSheet'
import { workspaceLabelFromPath } from '../../lib/workspace-label'
import { MobileModelPicker } from './MobileModelPicker'

/**
 * Settings content shared by the bottom sheet and the full-screen mobile
 * settings page: runtime health, project, and the default model. Everything
 * else points at the desktop app.
 */
export function MobileCodeSettingsBody(): React.JSX.Element {
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
  const runtimeLabel = state.runtimeConnection === 'ready' ? t('mobileRuntime_ready')
    : state.runtimeConnection === 'checking' ? t('mobileRuntime_checking')
    : state.runtimeConnection === 'offline' ? t('mobileRuntime_offline')
    : t('mobileRuntime_idle')

  return (
    <div className="kun-mobile-form">
      <dl className="kun-mobile-kv">
        <dt>{t('mobileRuntimeStatus')}</dt><dd>{runtimeLabel}</dd>
        <dt>{t('mobileDetailsProject')}</dt>
        <dd>{state.workspaceRoot ? workspaceLabelFromPath(state.workspaceRoot) : '—'}</dd>
        {state.workspaceRoot ? (
          <>
            <dt>{t('mobileDetailsPath')}</dt>
            <dd data-mono>{state.workspaceRoot}</dd>
          </>
        ) : null}
      </dl>
      <fieldset className="kun-mobile-field">
        <legend>{t('composerModel')}</legend>
        <MobileModelPicker
          model={state.composerModel}
          providerId={state.composerProviderId}
          groups={state.composerModelGroups}
          fallbackIds={state.composerPickList}
          onChange={(model, providerId) => state.setComposerModel(model, providerId)}
        />
      </fieldset>
      <p className="kun-mobile-hint">{t('mobileSettingsDesktopHint')}</p>
    </div>
  )
}

export function MobileCodeSettings({ open, onClose }: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation('common')
  return (
    <MobileSheet open={open} title={t('settings')} closeLabel={t('close')} onClose={onClose}>
      <MobileCodeSettingsBody />
    </MobileSheet>
  )
}
