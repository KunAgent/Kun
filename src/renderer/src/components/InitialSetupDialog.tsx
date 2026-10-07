import {
  APP_LOCALE_OPTIONS,
  DEFAULT_MODEL_PROVIDER_ID,
  getModelProviderPreset,
  kunToolPermissionModeSettings,
  normalizeAppSettings,
  type AppSettingsV1,
  type KunToolPermissionMode
} from '@shared/app-settings'
import type { AppLocale } from '@shared/app-locales'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { parseProviderImportLink } from '@shared/provider-import-link'
import { ArrowLeft, ArrowRight, Check, LayoutGrid, RotateCcw, ShieldAlert } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { runTrustedUserActivation } from '../extensions/protected-user-activation'
import { applyTheme } from '../lib/apply-theme'
import { emitRendererSettingsChanged } from '../lib/keyboard-shortcut-settings'
import { useChatStore } from '../store/chat-store'
import { useHarnessStore } from '../store/harness-store'
import '../styles/onboarding/shell.css'
import '../styles/onboarding/frame.css'
import '../styles/onboarding/steps.css'
import '../styles/onboarding/model.css'
import '../styles/onboarding/agents-ready.css'
import {
  canCloseInitialSetup,
  commitInitialSetupRegistryCredentials,
  dismissInitialSetup,
  finishInitialSetup,
  FIRST_RUN_PERMISSION_MODE,
  isUnreadableCredentialKeyError,
  PERMISSION_OPTIONS,
  themeOptions,
  verifyInitialSetupRuntime,
  type SetupFormPatch,
  type ThemePref
} from './initial-setup-dialog-support'
import {
  buildInitialSetupSettings,
  buildInitialSetupSettingsPatch,
  initialSetupAutoWirePlan,
  initialSetupDraftFor,
  initialSetupDrafts,
  initialSetupProfileId,
  initialSetupSelection,
  INITIAL_SETUP_CUSTOM_PRESET_ID,
  type InitialSetupDraft,
  type InitialSetupDrafts,
  type InitialSetupSelection
} from './initial-setup-save'
import {
  initialSetupPermissionMode,
  initialSetupPermissionPatch,
  withStoredExecutionSettings
} from './initial-setup-permission'
import { OnboardingAgentsStep } from './onboarding/OnboardingAgentsStep'
import { OnboardingModelConfigure } from './onboarding/OnboardingModelConfigure'
import { OnboardingModelPicker, type OnboardingPickerState } from './onboarding/OnboardingModelPicker'
import { OnboardingPermissionStep } from './onboarding/OnboardingPermissionStep'
import { OnboardingConfetti, OnboardingReadyStep } from './onboarding/OnboardingReadyStep'
import { OnboardingShell } from './onboarding/OnboardingShell'
import { OnboardingWelcomeStep } from './onboarding/OnboardingWelcomeStep'
import { onboardingAgentLists, onboardingAgentStatus } from './onboarding/onboarding-agents'
import {
  onboardingConfigureIssue,
  onboardingEntryForSelection,
  onboardingProviderCount,
  type OnboardingConfigureIssue,
  type OnboardingProviderEntry
} from './onboarding/onboarding-provider-catalog'
import {
  onboardingDirection,
  onboardingEnterAdvances,
  previousOnboardingStep,
  type OnboardingDirection,
  type OnboardingModelPhase,
  type OnboardingStep
} from './onboarding/onboarding-steps'
import { onboardingHarnessSettings, useOnboardingHarnessSettings } from './onboarding/use-onboarding-harness-settings'

export {
  canCloseInitialSetup,
  commitInitialSetupRegistryCredentials,
  dismissInitialSetup,
  finishInitialSetup,
  isUnreadableCredentialKeyError,
  verifyInitialSetupRuntime
} from './initial-setup-dialog-support'

const LEAVE_MS = 460

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

export function InitialSetupDialog(): ReactElement {
  const { t } = useTranslation('settings')
  const initialSetupMode = useChatStore((s) => s.initialSetupMode)
  const closeInitialSetup = useChatStore((s) => s.closeInitialSetup)
  const applyI18n = useChatStore((s) => s.applyI18nFromSettings)
  const reloadUiSettings = useChatStore((s) => s.reloadUiSettings)
  const probeRuntime = useChatStore((s) => s.probeRuntime)
  const openCode = useChatStore((s) => s.openCode)
  const openSettings = useChatStore((s) => s.openSettings)
  const harnessRows = useHarnessStore((s) => s.rows)

  const [form, setForm] = useState<AppSettingsV1 | null>(null)
  const [drafts, setDrafts] = useState<InitialSetupDrafts | null>(null)
  const [selection, setSelection] = useState<InitialSetupSelection>({
    presetId: DEFAULT_MODEL_PROVIDER_ID,
    mode: 'api',
    permissionMode: FIRST_RUN_PERMISSION_MODE,
    permissionTouched: false
  })
  const [step, setStep] = useState<OnboardingStep>('welcome')
  const [direction, setDirection] = useState<OnboardingDirection>('forward')
  const [modelPhase, setModelPhase] = useState<OnboardingModelPhase>('pick')
  const [picker, setPicker] = useState<OnboardingPickerState>({ tab: 'featured', region: 'all', query: '' })
  const [issue, setIssue] = useState<OnboardingConfigureIssue | null>(null)
  const [saving, setSaving] = useState<'saving' | 'starting' | null>(null)
  const [saved, setSaved] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [recoveringCredentials, setRecoveringCredentials] = useState(false)
  const [credentialRecoveryRequired, setCredentialRecoveryRequired] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The permission the user picked but did not confirm in Main's prompt. */
  const [declinedPermission, setDeclinedPermission] = useState<KunToolPermissionMode | null>(null)
  const formRef = useRef<AppSettingsV1 | null>(null)
  /** What Main last returned; the form also carries unsaved language and theme edits. */
  const storedRef = useRef<AppSettingsV1 | null>(null)
  const isPreview = initialSetupMode === 'preview'
  const closeAllowed = canCloseInitialSetup(initialSetupMode)

  const setCurrentForm = (next: AppSettingsV1 | null): void => {
    formRef.current = next
    setForm(next)
  }
  const rememberStored = (next: AppSettingsV1): void => {
    storedRef.current = next
    setCurrentForm(next)
  }
  const harness = useOnboardingHarnessSettings({ getForm: () => formRef.current, setForm: rememberStored })

  const reportSetupError = (setupError: unknown): void => {
    if (isUnreadableCredentialKeyError(setupError)) {
      setCredentialRecoveryRequired(true)
      setError(t('firstRunCredentialRecoveryError'))
      return
    }
    setError(setupError instanceof Error ? setupError.message : String(setupError))
  }

  useEffect(() => {
    let cancelled = false
    void rendererRuntimeClient
      .getSettings({ forceRefresh: true })
      .then((s) => {
        if (cancelled) return
        rememberStored(s)
        setDrafts(initialSetupDrafts(s))
        setSelection(initialSetupSelection(s, initialSetupMode === 'required'
          ? { defaultPermissionMode: FIRST_RUN_PERMISSION_MODE }
          : {}))
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
    // The guide reads settings once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateForm = (patch: SetupFormPatch): void => {
    const current = formRef.current
    if (!current) return
    setCurrentForm(normalizeAppSettings({ ...current, ...patch } as AppSettingsV1))
  }

  const goTo = (target: OnboardingStep): void => {
    setDirection(onboardingDirection(step, target))
    setStep(target)
    setError(null)
    setIssue(null)
  }

  const custom = selection.presetId === INITIAL_SETUP_CUSTOM_PRESET_ID
  const entry = onboardingEntryForSelection(selection)
  const profileId = initialSetupProfileId(selection)
  const draft = drafts ? initialSetupDraftFor(drafts, profileId) : { apiKey: '', baseUrl: '' }

  const updateDraft = (patch: Partial<InitialSetupDraft>): void => {
    setIssue(null)
    setError(null)
    setDrafts((current) => current
      ? { ...current, [profileId]: { ...initialSetupDraftFor(current, profileId), ...patch } }
      : current)
  }

  const selectEntry = (next: OnboardingProviderEntry): void => {
    setIssue(null)
    setSelection((current) => ({ ...current, presetId: next.presetId, mode: next.mode }))
  }

  const openConfigure = (): void => {
    setDirection('forward')
    setModelPhase('configure')
    setIssue(null)
  }

  const selectCustom = (): void => {
    setSelection((current) => ({ ...current, presetId: INITIAL_SETUP_CUSTOM_PRESET_ID, mode: 'api' }))
    openConfigure()
  }

  const applyImportLink = (raw: string): string | null => {
    const parsed = parseProviderImportLink(raw)
    if (!parsed.ok) return t('onboarding.model.importInvalid', { message: parsed.message })
    const link = parsed.draft
    const presetId = link.presetId && (link.presetId === DEFAULT_MODEL_PROVIDER_ID || getModelProviderPreset(link.presetId))
      ? link.presetId
      : null
    const nextSelection = { ...selection, presetId: presetId ?? INITIAL_SETUP_CUSTOM_PRESET_ID, mode: 'api' as const }
    const nextProfileId = initialSetupProfileId(nextSelection)
    const baseUrl = link.chatBaseUrl ?? link.anthropicBaseUrl ?? link.responsesBaseUrl
    setSelection(nextSelection)
    setDrafts((current) => {
      if (!current) return current
      const previous = initialSetupDraftFor(current, nextProfileId)
      return {
        ...current,
        [nextProfileId]: {
          ...previous,
          ...(link.key ? { apiKey: link.key } : {}),
          ...(presetId ? {} : {
            name: link.name ?? previous.name,
            baseUrl: baseUrl ?? previous.baseUrl,
            endpointFormat: link.chatBaseUrl ? 'chat_completions' : link.anthropicBaseUrl ? 'messages' : 'responses'
          }),
          ...(link.models.length ? { models: link.models, model: link.models[0] } : {})
        }
      }
    })
    openConfigure()
    return null
  }

  const finishModelStep = (): void => {
    const found = onboardingConfigureIssue(custom ? null : entry, profileId, draft)
    if (found) {
      setIssue(found)
      setError(found === 'key'
        ? t('firstRunApiKeyValidation', { provider: custom ? draft.name || t('onboarding.model.custom') : entry?.name ?? '' })
        : t(`onboarding.model.issues.${found}`))
      return
    }
    goTo('permission')
  }

  const selectPermissionMode = (event: MouseEvent<HTMLButtonElement>, permissionMode: KunToolPermissionMode): void => {
    runTrustedUserActivation(event, () => {
      setError(null)
      setDeclinedPermission(null)
      setSelection((current) => ({ ...current, permissionMode, permissionTouched: true }))
      const current = formRef.current
      if (!current) return
      updateForm({
        agents: { ...current.agents, kun: { ...current.agents.kun, ...kunToolPermissionModeSettings(permissionMode) } }
      } as SetupFormPatch)
    })
  }

  const handleSave = async (): Promise<void> => {
    const current = formRef.current
    if (!current || !drafts) return
    const found = onboardingConfigureIssue(custom ? null : entry, profileId, draft)
    if (found) {
      setDirection('backward')
      setStep('model')
      setModelPhase('configure')
      setIssue(found)
      return
    }
    setSaving('saving')
    setError(null)
    try {
      const stored = storedRef.current ?? current
      const base = withStoredExecutionSettings(current, stored)
      const intended = buildInitialSetupSettings(base, drafts, selection)
      const selectedProvider = intended.provider.providers.find((provider) => provider.id === profileId)
      if (!selectedProvider) throw new Error(`Provider ${profileId} is unavailable`)
      await commitInitialSetupRegistryCredentials(drafts, {
        profiles: intended.provider.providers,
        selectedProviderId: profileId,
        selectedModel: getKunRuntimeSettings(intended).model || selectedProvider.models[0] || ''
      })
      let next = await rendererRuntimeClient.setSettings(
        buildInitialSetupSettingsPatch(base, drafts, { presetId: selection.presetId, mode: selection.mode }, stored)
      )
      setCredentialRecoveryRequired(false)
      rememberStored(next)
      const permissionPatch = initialSetupPermissionPatch(next, selection)
      if (permissionPatch) {
        next = await rendererRuntimeClient.setSettings(permissionPatch)
        rememberStored(next)
      }
      setDrafts((existing) => ({ ...initialSetupDrafts(next), ...existing }))
      emitRendererSettingsChanged(next)
      await applyI18n(next.locale)
      const savedPermission = initialSetupPermissionMode(next)
      if (permissionPatch && savedPermission !== selection.permissionMode) {
        // The prompt was cancelled: stay here and show the mode Kun kept.
        setSelection((existing) => ({ ...existing, permissionMode: savedPermission, permissionTouched: false }))
        setDeclinedPermission(selection.permissionMode)
        return
      }
      setSaving('starting')
      const ready = await verifyInitialSetupRuntime({
        mode: initialSetupMode,
        reloadUiSettings,
        probeRuntime,
        getState: useChatStore.getState,
        setDialogError: setError,
        fallbackRuntimeError: t('common:runtimeFetchFailed')
      })
      if (ready) {
        setSaved(true)
        setDirection('forward')
        setStep('agents')
      }
    } catch (e) {
      reportSetupError(e)
    } finally {
      setSaving(null)
    }
  }

  const handleCredentialReset = async (): Promise<void> => {
    setRecoveringCredentials(true)
    setError(null)
    try {
      const result = await rendererRuntimeClient.resetUnreadableCredentials()
      if (!result.reset) {
        setError(t('firstRunCredentialRecoveryError'))
        return
      }
      setCredentialRecoveryRequired(false)
      await handleSave()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRecoveringCredentials(false)
    }
  }

  const leave = (after: () => Promise<void> | void): void => {
    if (leaving) return
    setLeaving(true)
    window.setTimeout(() => { void after() }, prefersReducedMotion() ? 150 : LEAVE_MS)
  }

  const finish = (): void => {
    leave(() => finishInitialSetup({ mode: initialSetupMode, openCode, closeInitialSetup }))
  }

  const openAgentCenter = (): void => {
    leave(() => {
      closeInitialSetup()
      openSettings('agentsHarnesses')
    })
  }

  const handleClose = (): void => {
    if (!closeAllowed) return
    if (saved) { finish(); return }
    setSaving('saving')
    setError(null)
    void dismissInitialSetup({
      mode: initialSetupMode,
      persistCompletion: async () => {
        const next = await rendererRuntimeClient.setSettings({ initialSetupCompleted: true })
        emitRendererSettingsChanged(next)
      },
      reloadUiSettings,
      probeRuntime,
      closeInitialSetup
    }).catch((e: unknown) => {
      reportSetupError(e)
    }).finally(() => {
      setSaving(null)
    })
  }

  if (!form || !drafts) {
    return (
      <div className="ds-no-drag fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-md dark:bg-black/70">
        <div className="rounded-xl border border-ds-border bg-ds-card/95 px-5 py-4 text-sm text-ds-muted shadow-panel backdrop-blur-xl">
          {error ?? t('loading')}
        </div>
      </div>
    )
  }

  const busy = saving !== null || recoveringCredentials
  const harnessSettings = onboardingHarnessSettings(form)
  const agentLists = onboardingAgentLists(harnessRows, harnessSettings)
  const connectedAgents = agentLists.installed
    .filter((row) => onboardingAgentStatus(row, harnessSettings) === 'connected')
    .map((row) => ({ id: row.definition.id, name: row.definition.displayName }))
  const localeLabel = APP_LOCALE_OPTIONS.find((option) => option.value === form.locale)?.label ?? form.locale
  const themeLabel = t(themeOptions.find((option) => option.value === form.theme)?.labelKey ?? 'themeSystem')
  const providerName = custom ? draft.name?.trim() || t('onboarding.model.custom') : entry?.name ?? 'DeepSeek'
  const permissionLabel = t(PERMISSION_OPTIONS.find((option) => option.value === selection.permissionMode)?.labelKey ?? 'toolPermissionFullAccess')
  const wirePlan = initialSetupAutoWirePlan(form, { ...drafts, [profileId]: { ...draft, apiKey: draft.apiKey || 'preview' } })
  const wireNote = wirePlan.speechProviderId === profileId
    ? t('firstRunAutoWireSpeech')
    : wirePlan.imageProviderId === profileId ? t('firstRunAutoWireImage') : null
  const connectKind = custom ? 'custom' : entry?.connect ?? 'key'

  const stepDetails: Record<OnboardingStep, string> = {
    welcome: step === 'welcome' ? t('onboarding.steps.welcome.detail') : `${localeLabel} · ${themeLabel}`,
    model: step === 'welcome' || (step === 'model' && modelPhase === 'pick') ? t('onboarding.steps.model.detail') : providerName,
    permission: step === 'ready' || step === 'agents' ? permissionLabel : t('onboarding.steps.permission.detail'),
    agents: connectedAgents.length ? t('onboarding.agents.connectedCount', { count: connectedAgents.length }) : t('onboarding.steps.agents.detail'),
    ready: t('onboarding.steps.ready.detail')
  }

  const bubble = step === 'welcome' ? t('onboarding.bubble.welcome')
    : step === 'model' ? t(modelPhase === 'pick' ? 'onboarding.bubble.modelPick' : `onboarding.bubble.model_${connectKind}`)
      : step === 'permission' ? t(`onboarding.bubble.permission_${PERMISSION_OPTIONS.find((option) => option.value === selection.permissionMode)?.tone ?? 'full'}`)
        : step === 'agents'
          ? t(agentLists.installed.length === 0 && !agentLists.detecting ? 'onboarding.bubble.agentsEmpty'
            : connectedAgents.length >= 2 ? 'onboarding.bubble.agentsMany' : 'onboarding.bubble.agents')
          : t('onboarding.bubble.ready')

  const back = (): void => {
    if (step === 'model' && modelPhase === 'configure') {
      setDirection('backward')
      setModelPhase('pick')
      setIssue(null)
      setError(null)
      return
    }
    goTo(previousOnboardingStep(step))
  }

  const primary = (): void => {
    if (busy || leaving) return
    if (step === 'welcome') goTo('model')
    else if (step === 'model') {
      if (modelPhase === 'pick') openConfigure()
      else finishModelStep()
    } else if (step === 'permission') void handleSave()
    else if (step === 'agents') goTo('ready')
    else finish()
  }

  const onEnter = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || !onboardingEnterAdvances(event.target)) return
    if ((event.target as HTMLInputElement).type === 'search') return
    event.preventDefault()
    primary()
  }

  const backButton = (label = t('onboarding.back')): ReactElement => (
    <button type="button" className="kun-onb-ghost" onClick={back} disabled={busy} data-onboarding-back>
      <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />{label}
    </button>
  )
  const primaryButton = (label: string, options: { large?: boolean; icon?: boolean } = {}): ReactElement => (
    <button
      type="button"
      className={options.large ? 'kun-onb-primary is-large' : 'kun-onb-primary'}
      onClick={primary}
      disabled={busy || leaving}
      data-busy={saving ? 'true' : undefined}
      data-onboarding-primary
    >
      {saving ? <span className="kun-onb-spin" /> : null}
      {label}
      {options.icon === false || saving ? null : <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />}
    </button>
  )

  const errorBlock = error || credentialRecoveryRequired ? (
    <div className="kun-onb-callout" data-tone="danger" role="alert">
      <ShieldAlert size={16} strokeWidth={1.9} aria-hidden="true" />
      <div className="kun-onb-recovery">
        {error ? <span>{error}</span> : null}
        {credentialRecoveryRequired ? (
          <>
            <span>{t('firstRunCredentialRecoveryDetail')}</span>
            <div className="kun-onb-callout-actions">
              <button type="button" className="kun-onb-btn" disabled={busy} onClick={() => { void handleSave() }}>
                <RotateCcw size={14} strokeWidth={1.9} aria-hidden="true" />{t('firstRunCredentialRetry')}
              </button>
              <button type="button" className="kun-onb-btn is-accent" disabled={busy} onClick={() => { void handleCredentialReset() }}>
                {recoveringCredentials ? t('firstRunCredentialResetting') : t('firstRunCredentialReset')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  ) : null

  let title = ''
  let subtitle = ''
  let body: ReactElement | null = null
  let footer: ReactElement | null = null
  if (step === 'welcome') {
    title = t('onboarding.welcome.title')
    subtitle = t('onboarding.welcome.subtitle')
    body = (
      <OnboardingWelcomeStep
        locale={form.locale}
        theme={form.theme}
        onLocale={(locale: AppLocale) => { updateForm({ locale }); void applyI18n(locale) }}
        onTheme={(theme: ThemePref) => { updateForm({ theme }); applyTheme(theme) }}
      />
    )
    footer = <><span />{primaryButton(t('onboarding.welcome.start'))}</>
  } else if (step === 'model') {
    title = t('onboarding.model.title')
    if (modelPhase === 'pick') {
      subtitle = t('onboarding.model.pickSubtitle', { count: onboardingProviderCount() })
      body = (
        <OnboardingModelPicker
          state={picker}
          selectedId={entry?.id ?? ''}
          customSelected={custom}
          onState={(patch) => setPicker((current) => ({ ...current, ...patch }))}
          onSelect={selectEntry}
          onConfirm={openConfigure}
          onCustom={selectCustom}
          onImport={applyImportLink}
        />
      )
      footer = (
        <>
          {backButton()}
          <div className="kun-onb-foot-end">
            <span className="kun-onb-foot-hint">{t('onboarding.model.selectedHint', { name: providerName })}</span>
            {primaryButton(t(`onboarding.model.next_${connectKind}`))}
          </div>
        </>
      )
    } else {
      subtitle = t('onboarding.model.configureSubtitle')
      body = (
        <>
          <OnboardingModelConfigure
            entry={custom ? null : entry}
            profileId={profileId}
            draft={draft}
            mode={selection.mode}
            issue={issue}
            wireNote={wireNote}
            onMode={(mode) => { setIssue(null); setSelection((current) => ({ ...current, mode })) }}
            onDraft={updateDraft}
            onChange={back}
          />
          {errorBlock}
        </>
      )
      footer = (
        <>
          {backButton(t('onboarding.model.backToPick'))}
          <div className="kun-onb-foot-end">
            <span className="kun-onb-foot-hint">{t('onboarding.model.moreLater')}</span>
            {primaryButton(t('onboarding.next'))}
          </div>
        </>
      )
    }
  } else if (step === 'permission') {
    title = t('onboarding.permission.title')
    subtitle = t('onboarding.permission.subtitle')
    body = (
      <>
        <OnboardingPermissionStep mode={selection.permissionMode} declined={declinedPermission} onSelect={selectPermissionMode} />
        {errorBlock}
      </>
    )
    footer = (
      <>
        {backButton()}
        <div className="kun-onb-foot-end">
          <span className="kun-onb-foot-hint" aria-live="polite">
            {t(saving === 'saving' ? 'onboarding.permission.savingHint' : saving === 'starting' ? 'onboarding.permission.startingHint' : 'onboarding.permission.saveHint')}
          </span>
          {primaryButton(saving === 'saving' ? t('firstRunSaving') : saving === 'starting' ? t('onboarding.permission.starting') : t('firstRunSave'))}
        </div>
      </>
    )
  } else if (step === 'agents') {
    title = t('onboarding.agents.title')
    subtitle = t('onboarding.agents.subtitle')
    body = <OnboardingAgentsStep settings={harnessSettings} patch={harness.patch} beforeCheck={harness.beforeCheck} />
    footer = (
      <>
        {backButton()}
        <div className="kun-onb-foot-end">
          <span className="kun-onb-foot-hint">{t('onboarding.agents.handshakeHint')}</span>
          {primaryButton(t(connectedAgents.length || agentLists.installed.length === 0 ? 'onboarding.next' : 'onboarding.agents.skipNext'))}
        </div>
      </>
    )
  } else {
    title = t('onboarding.ready.title')
    subtitle = t('onboarding.ready.subtitle')
    body = (
      <OnboardingReadyStep
        provider={{ presetId: custom ? null : entry?.presetId ?? DEFAULT_MODEL_PROVIDER_ID, name: providerName, model: getKunRuntimeSettings(form).model }}
        permissionMode={selection.permissionMode}
        agents={connectedAgents}
        localeLabel={localeLabel}
        themeLabel={themeLabel}
        onEdit={(target) => {
          if (target === 'model') setModelPhase('configure')
          goTo(target)
        }}
      />
    )
    footer = (
      <>
        <button type="button" className="kun-onb-ghost" onClick={openAgentCenter} disabled={leaving}>
          <LayoutGrid size={16} strokeWidth={1.8} aria-hidden="true" />{t('onboarding.ready.openAgentCenter')}
        </button>
        {primaryButton(t(isPreview ? 'onboarding.ready.done' : 'onboarding.ready.start'), { large: true })}
      </>
    )
  }

  return (
    <OnboardingShell
      step={step}
      direction={direction}
      contentKey={`${step}-${modelPhase}`}
      saved={saved}
      preview={isPreview}
      leaving={leaving}
      stepDetails={stepDetails}
      bubble={bubble}
      title={title}
      subtitle={subtitle}
      optional={step === 'agents'}
      skipLabel={t(isPreview ? 'onboarding.close' : saved ? 'onboarding.skipRest' : 'onboarding.skip')}
      skipDisabled={busy}
      onSkip={closeAllowed && step !== 'ready' ? handleClose : undefined}
      onStepSelect={(target) => {
        if (target === 'model') setModelPhase(saved ? 'configure' : 'pick')
        goTo(target)
      }}
      onEnter={onEnter}
      footer={footer}
      overlay={step === 'ready' ? <OnboardingConfetti /> : null}
    >
      {step === 'ready' ? (
        <span className="kun-onb-done-chip" style={{ alignSelf: 'flex-start' }}>
          <Check size={13} strokeWidth={2.6} aria-hidden="true" />{t('onboarding.ready.saved')}
        </span>
      ) : null}
      {body}
    </OnboardingShell>
  )
}
