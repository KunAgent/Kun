import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { ApprovalPolicy, AppSettingsV1, SandboxMode, WindowCloseAction } from '@shared/app-settings'
import {
  CHECKPOINT_CLEANUP_INTERVAL_DAYS,
  DEFAULT_CURSOR_SPOTLIGHT_COLOR,
  CHAT_CONTENT_MAX_WIDTH_MAX,
  CHAT_CONTENT_MAX_WIDTH_MIN,
  DEFAULT_WRITE_INLINE_COMPLETION_BASE_URL,
  DEFAULT_WRITE_INLINE_COMPLETION_MAX_TOKENS,
  DEFAULT_WRITE_INLINE_COMPLETION_MODEL,
  DEFAULT_WRITE_INLINE_LONG_COMPLETION_MAX_TOKENS,
  DEFAULT_KUN_DATA_DIR,
  UI_FONT_SCALE_MAX,
  UI_FONT_SCALE_MIN,
  WRITE_INLINE_COMPLETION_MODEL_IDS,
  isKunRuntimeInsecure,
  normalizeChatContentMaxWidth,
  normalizeUiFontScale
} from '@shared/app-settings'
import type { SkillRootId } from '../lib/skill-root-preference'
import { FolderOpen, Loader2, PencilLine, RefreshCw, Settings } from 'lucide-react'
import {
  InlineNoticeView,
  SectionJumpButton,
  SettingsCard,
  SettingRow,
  Toggle
} from './settings-controls'
import { LegacySessionImportCard } from './settings-section-general-legacy-import'

type Rgb = { r: number; g: number; b: number }

function normalizeHexColor(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CURSOR_SPOTLIGHT_COLOR
  const color = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(color) ? color : DEFAULT_CURSOR_SPOTLIGHT_COLOR
}

function hexToRgb(color: string): Rgb {
  return {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16)
  }
}

function rgbToHex(rgb: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * amount),
    g: Math.round(from.g + (to.g - from.g) * amount),
    b: Math.round(from.b + (to.b - from.b) * amount)
  }
}

function spotlightColorScale(color: string): string[] {
  const rgb = hexToRgb(normalizeHexColor(color))
  return [
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.46)),
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.28)),
    rgbToHex(mixRgb(rgb, { r: 0, g: 0, b: 0 }, 0.12)),
    rgbToHex(rgb),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.18)),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.36)),
    rgbToHex(mixRgb(rgb, { r: 255, g: 255, b: 255 }, 0.54))
  ]
}

function SpotlightColorControl({
  color,
  disabled,
  t,
  onChange
}: {
  color: string
  disabled: boolean
  t: (key: string, values?: Record<string, unknown>) => string
  onChange: (color: string) => void
}): ReactElement {
  const normalized = normalizeHexColor(color)
  const [baseColor, setBaseColor] = useState(normalized)
  const [toneIndex, setToneIndex] = useState(3)
  const [draftColor, setDraftColor] = useState(normalized)
  const scale = useMemo(() => spotlightColorScale(baseColor), [baseColor])
  const gradient = `linear-gradient(90deg, ${scale.join(', ')})`
  useEffect(() => {
    setDraftColor(normalized)
    const nextIndex = scale.indexOf(normalized)
    if (nextIndex >= 0) {
      setToneIndex(nextIndex)
      return
    }
    setBaseColor(normalized)
    setToneIndex(3)
  }, [normalized, scale])
  const selectColor = (nextColor: string): void => {
    const next = normalizeHexColor(nextColor)
    setBaseColor(next)
    setToneIndex(3)
    onChange(next)
  }
  const selectTone = (index: number): void => {
    const nextIndex = Math.max(0, Math.min(scale.length - 1, index))
    setToneIndex(nextIndex)
    onChange(scale[nextIndex] ?? normalized)
  }
  return (
    <div className="grid w-full min-w-0 gap-2 rounded-xl border border-ds-border-muted bg-ds-main/35 p-3">
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={normalized}
          aria-label={t('cursorSpotlightColor')}
          disabled={disabled}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-ds-border bg-transparent p-1 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => selectColor(event.target.value)}
        />
        <input
          className="min-w-0 flex-1 rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[13px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30 disabled:opacity-60"
          value={draftColor}
          disabled={disabled}
          spellCheck={false}
          onChange={(event) => {
            const next = event.target.value.trim()
            setDraftColor(event.target.value)
            if (/^#[0-9a-fA-F]{6}$/.test(next)) selectColor(next)
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(draftColor.trim())) setDraftColor(normalized)
          }}
        />
        <button
          type="button"
          disabled={disabled || normalized === DEFAULT_CURSOR_SPOTLIGHT_COLOR}
          onClick={() => selectColor(DEFAULT_CURSOR_SPOTLIGHT_COLOR)}
          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12px] font-medium text-ds-muted shadow-sm transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('cursorSpotlightColorReset')}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={scale.length - 1}
        step={1}
        value={toneIndex}
        aria-label={t('cursorSpotlightColorTone')}
        disabled={disabled}
        className="h-2 w-full cursor-pointer rounded-full accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: gradient }}
        onChange={(event) => selectTone(Number(event.target.value))}
      />
      <div className="flex gap-1.5">
        {scale.map((shade, index) => (
          <button
            key={`${shade}-${index}`}
            type="button"
            disabled={disabled}
            aria-label={t('cursorSpotlightColorShade', { index: index + 1 })}
            title={shade}
            className={`h-6 min-w-0 flex-1 rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50 ${
              shade === normalized ? 'border-ds-ink ring-1 ring-ds-ink/25' : 'border-ds-border hover:scale-[1.02]'
            }`}
            style={{ backgroundColor: shade }}
            onClick={() => selectTone(index)}
          />
        ))}
      </div>
      <p className="text-[12px] leading-5 text-ds-faint">{t('cursorSpotlightColorDesc')}</p>
    </div>
  )
}

export function GeneralSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    tCommon,
    form,
    kun,
    update,
    updateKun,
    showRuntimeToken,
    setShowRuntimeToken,
    portError,
    selectControlClass,
    openOnboardingPreview,
    pickWorkspace,
    resetWorkspaceToDefault,
    workspacePickerError,
    pickConversationWorkspace,
    resetConversationWorkspaceToDefault,
    conversationWorkspacePickerError,
    logPath,
    logDirOpenError,
    setLogDirOpenError,
    compactHomePath,
    expandHomePath,
    pickWriteWorkspace,
    resetWriteWorkspaceToDefault,
    writeWorkspacePickerError,
    writeInlineBaseUrlInherited,
    effectiveWriteInlineBaseUrl,
    writeInlineModelInherited,
    effectiveWriteInlineModel,
    setWriteDebugModalOpen,
    loadWriteDebugEntries,
    scrollToAgentSection,
    agentsSectionRef,
    skillSectionRef,
    mcpSectionRef,
    permissionsSectionRef,
    selectedSkillRoot,
    skillRootOptions,
    skillRootId,
    setSkillRootId,
    skillNotice,
    openSkillRoot,
    openPlugins,
    mcpConfigPath,
    mcpConfigExists,
    mcpConfigText,
    setMcpConfigText,
    mcpLoading,
    mcpBusy,
    mcpNotice,
    saveMcpConfig,
    loadMcpConfig,
    openMcpConfigDir,
    pickClawWorkspace,
    resetClawWorkspaceToDefault,
    clawWorkspacePickerError,
    splitSettingsList,
    listSettingsText
  } = ctx
  const platform = typeof window !== 'undefined' ? window.kunGui?.platform ?? '' : ''
  const openAtLoginSupported = platform === 'win32' || platform === 'darwin'
  const startMinimizedSupported = platform === 'win32'
  const desktopBehavior = form.appBehavior
  const closeAction = desktopBehavior.closeAction ?? (desktopBehavior.closeToTray ? 'tray' : 'ask')
  const closeActionOptions: WindowCloseAction[] = ['ask', 'tray', 'quit']
  const checkpointCleanupIntervalOptions = Array.from(CHECKPOINT_CLEANUP_INTERVAL_DAYS)
  const fontScale = normalizeUiFontScale(form.uiFontScale)
  const fontScalePercent = Math.round(fontScale * 100)
  const setFontScale = (value: number): void => update({ uiFontScale: normalizeUiFontScale(value) })
  const chatContentMaxWidthPx = normalizeChatContentMaxWidth(form.chatContentMaxWidthPx)
  const setChatContentMaxWidthPx = (value: number): void =>
    update({ chatContentMaxWidthPx: normalizeChatContentMaxWidth(value) })
  const cursorSpotlightColor = normalizeHexColor(form.cursorSpotlightColor)

  return (
            <>
              <SettingsCard title={t('sectionGeneral')}>
                <SettingRow
                  title={t('language')}
                  description={t('languageDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.locale}
                      onChange={(e) => update({ locale: e.target.value as 'en' | 'zh' })}
                    >
                      <option value="en">English</option>
                      <option value="zh">简体中文</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('theme')}
                  description={t('themeDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.theme}
                      onChange={(e) => update({ theme: e.target.value as AppSettingsV1['theme'] })}
                    >
                      <option value="system">{t('themeSystem')}</option>
                      <option value="light">{t('themeLight')}</option>
                      <option value="dark">{t('themeDark')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('fontScale')}
                  description={t('fontScaleDesc')}
                  control={
                    <div className="w-full min-w-0 space-y-2.5 md:max-w-md">
                      <div className="flex items-center gap-3">
                        <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                          A
                        </span>
                        <input
                          type="range"
                          min={UI_FONT_SCALE_MIN}
                          max={UI_FONT_SCALE_MAX}
                          step={0.01}
                          value={fontScale}
                          aria-label={t('fontScale')}
                          className="w-full accent-accent"
                          onChange={(e) => setFontScale(Number(e.target.value))}
                        />
                        <span className="shrink-0 text-[18px] leading-none text-ds-faint" aria-hidden="true">
                          A
                        </span>
                        <div className="inline-flex shrink-0 items-center rounded-lg border border-ds-border bg-ds-card">
                          <button
                            type="button"
                            aria-label={t('fontScaleSmall')}
                            className="flex h-7 w-7 items-center justify-center rounded-l-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            onClick={() => setFontScale(fontScale - 0.05)}
                          >
                            −
                          </button>
                          <div className="flex h-7 w-[3.75rem] items-center justify-center border-x border-ds-border tabular-nums">
                            <input
                              type="number"
                              min={Math.round(UI_FONT_SCALE_MIN * 100)}
                              max={Math.round(UI_FONT_SCALE_MAX * 100)}
                              step={1}
                              value={fontScalePercent}
                              aria-label={t('fontScale')}
                              className="hide-number-spinner w-8 border-0 bg-transparent p-0 text-center text-[13px] font-medium text-ds-ink outline-none"
                              onChange={(e) => setFontScale(Number(e.target.value) / 100)}
                            />
                            <span className="text-[11px] text-ds-faint">%</span>
                          </div>
                          <button
                            type="button"
                            aria-label={t('fontScaleLarge')}
                            className="flex h-7 w-7 items-center justify-center rounded-r-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            onClick={() => setFontScale(fontScale + 0.05)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                />
                <SettingRow
                  title={t('chatContentMaxWidth')}
                  description={t('chatContentMaxWidthDesc')}
                  control={
                    <div className="w-full min-w-0 space-y-2.5 md:max-w-md">
                      <div className="flex items-center gap-3">
                        <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                          {t('chatContentMaxWidthNarrow')}
                        </span>
                        <input
                          type="range"
                          min={CHAT_CONTENT_MAX_WIDTH_MIN}
                          max={CHAT_CONTENT_MAX_WIDTH_MAX}
                          step={8}
                          value={chatContentMaxWidthPx}
                          aria-label={t('chatContentMaxWidth')}
                          className="w-full accent-accent"
                          onChange={(e) => setChatContentMaxWidthPx(Number(e.target.value))}
                        />
                        <span className="shrink-0 text-[12px] leading-none text-ds-faint" aria-hidden="true">
                          {t('chatContentMaxWidthWide')}
                        </span>
                        <div className="inline-flex shrink-0 items-center rounded-lg border border-ds-border bg-ds-card">
                          <button
                            type="button"
                            aria-label={t('chatContentMaxWidthDecrease')}
                            className="flex h-7 w-7 items-center justify-center rounded-l-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            onClick={() => setChatContentMaxWidthPx(chatContentMaxWidthPx - 32)}
                          >
                            −
                          </button>
                          <div className="flex h-7 min-w-[4.5rem] items-center justify-center border-x border-ds-border px-2 tabular-nums">
                            <input
                              type="number"
                              min={CHAT_CONTENT_MAX_WIDTH_MIN}
                              max={CHAT_CONTENT_MAX_WIDTH_MAX}
                              step={8}
                              value={chatContentMaxWidthPx}
                              aria-label={t('chatContentMaxWidth')}
                              className="hide-number-spinner w-full border-0 bg-transparent p-0 text-center text-[13px] font-medium text-ds-ink outline-none"
                              onChange={(e) => setChatContentMaxWidthPx(Number(e.target.value))}
                            />
                            <span className="text-[11px] text-ds-faint">px</span>
                          </div>
                          <button
                            type="button"
                            aria-label={t('chatContentMaxWidthIncrease')}
                            className="flex h-7 w-7 items-center justify-center rounded-r-lg text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                            onClick={() => setChatContentMaxWidthPx(chatContentMaxWidthPx + 32)}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                />
                <SettingRow
                  title={t('workspaceRoot')}
                  description={t('workspaceRootDesc')}
                  control={
                    <div className="grid w-full min-w-0 gap-2 md:max-w-xl">
                      <div className="min-w-0">
                        <input
                          className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={compactHomePath(form.workspaceRoot)}
                          onChange={(e) => update({ workspaceRoot: expandHomePath(e.target.value) })}
                          placeholder={t('workspaceRootPlaceholder')}
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={resetWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {workspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {workspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('conversationWorkspaceRoot')}
                  description={t('conversationWorkspaceRootDesc')}
                  control={
                    <div className="grid w-full min-w-0 gap-2 md:max-w-xl">
                      <div className="min-w-0">
                        <input
                          className="w-full min-w-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
                          value={compactHomePath(form.conversationWorkspaceRoot)}
                          onChange={(e) => update({ conversationWorkspaceRoot: expandHomePath(e.target.value) })}
                          placeholder={t('conversationWorkspaceRootPlaceholder')}
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={resetConversationWorkspaceToDefault}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('restoreConversationWorkspaceDefault')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void pickConversationWorkspace()}
                          className="shrink-0 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                        >
                          {t('browse')}
                        </button>
                      </div>
                      {conversationWorkspacePickerError ? (
                        <p className="mt-2 text-[13px] leading-5 text-amber-700 dark:text-amber-300">
                          {conversationWorkspacePickerError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
                <SettingRow
                  title={t('cursorSpotlight')}
                  description={t('cursorSpotlightDesc')}
                  control={
                    <div className="grid w-full min-w-0 gap-3 md:max-w-md">
                      <div className="flex justify-end">
                        <Toggle
                          checked={form.cursorSpotlight !== false}
                          onChange={(enabled) => update({ cursorSpotlight: enabled })}
                        />
                      </div>
                      <SpotlightColorControl
                        color={cursorSpotlightColor}
                        disabled={form.cursorSpotlight === false}
                        t={t}
                        onChange={(color) => update({ cursorSpotlightColor: color })}
                      />
                    </div>
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('desktopBehavior')} className="mt-6">
                <SettingRow
                  title={t('desktopOpenAtLogin')}
                  description={
                    openAtLoginSupported
                      ? t('desktopOpenAtLoginDesc')
                      : t('desktopOpenAtLoginUnsupportedDesc')
                  }
                  control={
                    <Toggle
                      checked={desktopBehavior.openAtLogin}
                      disabled={!openAtLoginSupported}
                      onChange={(v) =>
                        update({
                          appBehavior: {
                            openAtLogin: v,
                            startMinimized: v ? desktopBehavior.startMinimized : false
                          }
                        })
                      }
                    />
                  }
                />
                <SettingRow
                  title={t('desktopStartMinimized')}
                  description={
                    desktopBehavior.openAtLogin && startMinimizedSupported
                      ? t('desktopStartMinimizedDesc')
                      : t('desktopStartMinimizedDisabledDesc')
                  }
                  control={
                    <Toggle
                      checked={desktopBehavior.startMinimized}
                      disabled={!desktopBehavior.openAtLogin || !startMinimizedSupported}
                      onChange={(v) => update({ appBehavior: { startMinimized: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('desktopCloseAction')}
                  description={t('desktopCloseActionDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={closeAction}
                      onChange={(e) => update({ appBehavior: { closeAction: e.target.value as WindowCloseAction } })}
                    >
                      {closeActionOptions.map((option) => (
                        <option key={option} value={option}>
                          {t(`desktopCloseAction_${option}`)}
                        </option>
                      ))}
                    </select>
                  }
                />
                <SettingRow
                  title={t('turnCompleteNotification')}
                  description={t('turnCompleteNotificationDesc')}
                  control={
                    <Toggle
                      checked={form.notifications.turnComplete}
                      onChange={(v) => update({ notifications: { turnComplete: v } })}
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('onboardingPreview')} className="mt-6">
                <SettingRow
                  title={t('onboardingPreview')}
                  description={t('onboardingPreviewDesc')}
                  control={
                    <button
                      type="button"
                      onClick={openOnboardingPreview}
                      className="inline-flex w-fit items-center rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover"
                    >
                      {t('onboardingPreviewOpen')}
                    </button>
                  }
                />
              </SettingsCard>

              <LegacySessionImportCard t={t} tCommon={tCommon} />

              <SettingsCard title={t('gitCheckpointTitle')} className="mt-6">
                <SettingRow
                  title={t('checkpointCleanupEnabled')}
                  description={t('checkpointCleanupEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.checkpointCleanup.enabled}
                      onChange={(v) => update({ checkpointCleanup: { enabled: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('checkpointCleanupInterval')}
                  description={t('checkpointCleanupIntervalDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.checkpointCleanup.intervalDays}
                      disabled={!form.checkpointCleanup.enabled}
                      onChange={(e) =>
                        update({
                          checkpointCleanup: {
                            intervalDays: Number(e.target.value) as AppSettingsV1['checkpointCleanup']['intervalDays']
                          }
                        })
                      }
                    >
                      {checkpointCleanupIntervalOptions.map((days) => (
                        <option key={days} value={days}>
                          {t(`checkpointCleanupInterval${days}`)}
                        </option>
                      ))}
                    </select>
                  }
                />
                <SettingRow
                  title={t('checkpointDirectory')}
                  description={t('checkpointDirectoryDesc')}
                  control={
                    <input
                      type="text"
                      className={selectControlClass}
                      placeholder={t('checkpointDirectoryPlaceholder')}
                      value={form.checkpointCleanup.directory ?? ''}
                      onChange={(e) => update({ checkpointCleanup: { directory: e.target.value } })}
                    />
                  }
                />
                <SettingRow
                  title={t('checkpointMaxPerThread')}
                  description={t('checkpointMaxPerThreadDesc')}
                  control={
                    <input
                      type="number"
                      min={1}
                      max={100}
                      className={selectControlClass}
                      value={form.checkpointCleanup.maxPerThread ?? 5}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        update({ checkpointCleanup: { maxPerThread: Number.isFinite(n) ? Math.max(1, Math.min(100, Math.floor(n))) : 5 } })
                      }}
                    />
                  }
                />
              </SettingsCard>

              <SettingsCard title={t('logTitle')} className="mt-6">
                <SettingRow
                  title={t('logEnabled')}
                  description={t('logEnabledDesc')}
                  control={
                    <Toggle
                      checked={form.log.enabled}
                      onChange={(v) => update({ log: { enabled: v } })}
                    />
                  }
                />
                <SettingRow
                  title={t('logRetention')}
                  description={t('logRetentionDesc')}
                  control={
                    <select
                      className={selectControlClass}
                      value={form.log.retentionDays}
                      onChange={(e) =>
                        update({ log: { retentionDays: Number(e.target.value) } })
                      }
                    >
                      <option value={1}>{t('logRetentionOne')}</option>
                      <option value={2}>{t('logRetentionTwo')}</option>
                      <option value={3}>{t('logRetentionThree')}</option>
                      <option value={5}>{t('logRetentionFive')}</option>
                      <option value={7}>{t('logRetentionSeven')}</option>
                    </select>
                  }
                />
                <SettingRow
                  title={t('logDir')}
                  description={t('logDirDesc')}
                  wideControl
                  control={
                    <div className="flex w-full min-w-0 flex-col items-start gap-2">
                      {logPath ? (
                        <code className="block w-full max-w-full break-all rounded-xl border border-ds-border-muted bg-ds-main/60 px-3 py-2 font-mono text-[12px] text-ds-ink">
                          {compactHomePath(logPath)}
                        </code>
                      ) : (
                        <span className="text-[13px] text-ds-faint">…</span>
                      )}
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-1.5 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
                        disabled={typeof window.kunGui?.openLogDir !== 'function'}
                        onClick={async () => {
                          if (typeof window.kunGui?.openLogDir !== 'function') return
                          setLogDirOpenError(null)
                          try {
                            const result = await window.kunGui.openLogDir()
                            if (!result.ok) setLogDirOpenError(result.message ?? 'Unknown error')
                          } catch (e) {
                            setLogDirOpenError(e instanceof Error ? e.message : String(e))
                          }
                        }}
                      >
                        <FolderOpen className="h-4 w-4" />
                        {t('logDirOpen')}
                      </button>
                      {logDirOpenError ? (
                        <p className="text-[12px] text-red-700 dark:text-red-300">
                          {logDirOpenError}
                        </p>
                      ) : null}
                    </div>
                  }
                />
              </SettingsCard>
            </>
  )
}
