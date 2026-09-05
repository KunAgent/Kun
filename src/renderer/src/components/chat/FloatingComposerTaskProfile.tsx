import { useCallback, useEffect, useId, useRef, useState, type ReactElement } from 'react'
import {
  Apple,
  BookOpenText,
  Box,
  Braces,
  Check,
  ChevronDown,
  Component,
  Grid3X3,
  Hexagon,
  Image,
  Layers3,
  LayoutGrid,
  LockKeyhole,
  Monitor,
  Palette,
  PanelsTopLeft,
  Settings2,
  ShoppingBag,
  Smartphone,
  Sparkles,
  SquareStack,
  Triangle,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DESIGN_SYSTEM_PRESETS, type DesignSystemPreset } from '@shared/app-settings'
import { DESIGN_SYSTEM_DISPLAY } from '../../design/design-context'
import type { DesignPresetSource } from '../../agent/design-task-profile'
import {
  FloatingComposerProfileSelect,
  type ComposerProfileSelectOption
} from './FloatingComposerProfileSelect'

import type { ComposerTaskSurface } from './FloatingComposerTaskSurfacePicker'

export type DesignTaskOutputMedium = 'html' | 'image'

export type DesignTaskComposerProfile = {
  outputMedium: DesignTaskOutputMedium
  target: 'web' | 'app'
  preset: DesignSystemPreset
  presetSource?: DesignPresetSource
  styleSourceName?: string
  styleSourceHash?: string
}

type Props = {
  surface: ComposerTaskSurface
  locked: boolean
  profileLocked?: boolean
  disabled?: boolean
  profile: DesignTaskComposerProfile
  imageGenerationEnabled?: boolean
  imageGenerationAvailable: boolean
  imageGenerationReason?: string
  onSurfaceChange?: (surface: ComposerTaskSurface) => void
  onProfileChange?: (patch: Partial<DesignTaskComposerProfile>) => void
  onConfigureImageGeneration?: () => void
}

const DESIGN_STYLE_MARKS: Record<DesignSystemPreset, { icon: LucideIcon; className: string }> = {
  none: { icon: Sparkles, className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300' },
  shadcn: { icon: Braces, className: 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950' },
  radix: { icon: Component, className: 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-50' },
  material: { icon: Layers3, className: 'bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300' },
  ios: { icon: Apple, className: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-400/15 dark:text-indigo-300' },
  fluent: { icon: LayoutGrid, className: 'bg-sky-50 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300' },
  ant: { icon: Hexagon, className: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-300' },
  chakra: { icon: Zap, className: 'bg-teal-50 text-teal-600 dark:bg-teal-400/15 dark:text-teal-300' },
  carbon: { icon: Grid3X3, className: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200' },
  polaris: { icon: ShoppingBag, className: 'bg-green-50 text-green-700 dark:bg-green-400/15 dark:text-green-300' },
  bootstrap: { icon: Box, className: 'bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300' },
  geist: { icon: Triangle, className: 'bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950' },
  brutalism: { icon: SquareStack, className: 'bg-amber-100 text-zinc-950 dark:bg-amber-300 dark:text-zinc-950' },
  editorial: { icon: BookOpenText, className: 'bg-stone-100 text-stone-800 dark:bg-stone-700 dark:text-stone-100' }
}

function DesignStyleMark({ preset }: { preset: DesignSystemPreset }): ReactElement {
  const mark = DESIGN_STYLE_MARKS[preset]
  const Icon = mark.icon
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${mark.className}`}
      aria-hidden="true"
      data-design-style-icon={preset}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  )
}

type DesignStylePopupPlacement = 'top' | 'bottom'

export function resolveDesignProfileSummaryPopupLayout(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number
): { placement: DesignStylePopupPlacement; maxHeight: number } {
  const viewportMargin = 16
  const popupGap = 8
  const preferredHeight = 320
  const spaceAbove = Math.max(0, trigger.top - viewportMargin - popupGap)
  const spaceBelow = Math.max(0, viewportHeight - trigger.bottom - viewportMargin - popupGap)
  const placement = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  return {
    placement,
    maxHeight: Math.min(preferredHeight, placement === 'bottom' ? spaceBelow : spaceAbove)
  }
}

type DesignProfileSummaryProps = {
  disabled: boolean
  locked: boolean
  profileLocked: boolean
  outputOptions: ReadonlyArray<ComposerProfileSelectOption<DesignTaskOutputMedium>>
  effectiveOutputMedium: DesignTaskOutputMedium
  outputLabel: string
  targetLabel: string
  presetLabel: string
  profile: DesignTaskComposerProfile
  imageGenerationStateKnown: boolean
  imageGenerationAvailable: boolean
  imageGenerationReason?: string
  onProfileChange?: (patch: Partial<DesignTaskComposerProfile>) => void
  onConfigureImageGeneration?: () => void
}

function DesignProfileSummary({
  disabled,
  locked,
  profileLocked,
  outputOptions,
  effectiveOutputMedium,
  outputLabel,
  targetLabel,
  presetLabel,
  profile,
  imageGenerationStateKnown,
  imageGenerationAvailable,
  imageGenerationReason,
  onProfileChange,
  onConfigureImageGeneration
}: DesignProfileSummaryProps): ReactElement {
  const { t } = useTranslation('common')
  const profileControlsDisabled = disabled || profileLocked
  const [popupLayout, setPopupLayout] = useState<{
    placement: DesignStylePopupPlacement
    maxHeight: number
  }>({ placement: 'bottom', maxHeight: 320 })
  const rootRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)

  const handleToggle = (): void => {
    if (!rootRef.current?.open) return
    const trigger = summaryRef.current?.getBoundingClientRect()
    if (!trigger) return
    setPopupLayout(resolveDesignProfileSummaryPopupLayout(trigger, window.innerHeight))
  }

  return (
    <details
      ref={rootRef}
      onToggle={handleToggle}
      className="ds-design-profile-summary ds-no-drag group relative ml-auto shrink-0"
      data-task-surface="design"
      data-task-surface-locked={locked ? 'true' : 'false'}
    >
      <summary
        ref={summaryRef}
        className="flex h-9 max-w-[360px] cursor-pointer list-none items-center gap-2 rounded-full border border-ds-border-muted bg-white px-3 text-[12.5px] font-medium text-ds-muted transition hover:border-ds-border-strong hover:text-ds-ink dark:bg-ds-card [&::-webkit-details-marker]:hidden"
      >
        <Palette className="h-3.5 w-3.5 shrink-0 text-ds-ink" strokeWidth={1.9} />
        <span className="shrink-0 font-semibold text-ds-ink">
          {t('designConfiguration', { defaultValue: 'Design configuration' })}
        </span>
        <span className="min-w-0 truncate text-ds-faint">
          {outputLabel} · {targetLabel} · {presetLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition group-open:rotate-180" strokeWidth={1.8} />
      </summary>
      <div
        className={`absolute right-0 z-40 w-[min(400px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-ds-border-muted bg-white p-3 shadow-[0_18px_50px_rgba(15,23,42,0.14)] dark:bg-ds-card ${
          popupLayout.placement === 'top'
            ? 'bottom-[calc(100%+8px)]'
            : 'top-[calc(100%+8px)]'
        }`}
        style={{ maxHeight: popupLayout.maxHeight }}
        data-placement={popupLayout.placement}
      >
        <div className="grid gap-2.5">
          <FloatingComposerProfileSelect<DesignTaskOutputMedium>
            pickerId="output"
            label={t('designOutput', { defaultValue: 'Output' })}
            value={effectiveOutputMedium}
            options={outputOptions as [
              ComposerProfileSelectOption<DesignTaskOutputMedium>,
              ...Array<ComposerProfileSelectOption<DesignTaskOutputMedium>>
            ]}
            disabled={profileControlsDisabled}
            onChange={onProfileChange
              ? (outputMedium) => onProfileChange({ outputMedium })
              : undefined}
          />
          <FloatingComposerProfileSelect<'web' | 'app'>
            pickerId="target"
            label={t('designTarget', { defaultValue: 'Target' })}
            value={profile.target}
            options={[
              {
                value: 'web',
                label: t('designTargetWeb', { defaultValue: 'Web' }),
                icon: Monitor,
                iconClassName: 'bg-blue-50 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300'
              },
              {
                value: 'app',
                label: t('designTargetApp', { defaultValue: 'App' }),
                icon: Smartphone,
                iconClassName: 'bg-sky-50 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300'
              }
            ]}
            disabled={profileControlsDisabled}
            onChange={onProfileChange
              ? (target) => onProfileChange({ target })
              : undefined}
          />
          <DesignStylePicker
            value={profile.preset}
            disabled={profileControlsDisabled}
            onChange={onProfileChange
              ? (preset) => onProfileChange({ preset })
              : undefined}
          />
          {profile.presetSource === 'root-design-md' ? (
            <div
              className="flex min-w-0 items-center gap-1.5 rounded-xl border border-ds-border-muted bg-ds-surface-subtle px-2.5 py-1.5 text-[11.5px] font-medium text-ds-muted"
              data-design-style-source="root-design-md"
              title={profile.styleSourceHash
                ? `${profile.styleSourceName || 'DESIGN.md'} · ${profile.styleSourceHash}`
                : profile.styleSourceName || 'DESIGN.md'}
            >
              <Palette className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="truncate">
                {t('designStyleProjectSource', {
                  defaultValue: 'Project DESIGN.md: {{name}}',
                  name: profile.styleSourceName || 'DESIGN.md'
                })}
              </span>
            </div>
          ) : null}
          {effectiveOutputMedium === 'image' &&
          imageGenerationStateKnown &&
          !imageGenerationAvailable ? (
            <button
              type="button"
              onClick={onConfigureImageGeneration}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl bg-amber-500/10 px-2.5 text-[11.5px] font-medium text-amber-700 transition hover:bg-amber-500/15 dark:text-amber-200"
              title={imageGenerationReason}
            >
              <Settings2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('designConfigureImageGeneration', { defaultValue: 'Configure image generation' })}
            </button>
          ) : null}
        </div>
      </div>
    </details>
  )
}

export function resolveDesignStylePopupLayout(
  trigger: Pick<DOMRect, 'top' | 'bottom'>,
  viewportHeight: number
): { placement: DesignStylePopupPlacement; maxHeight: number } {
  const viewportMargin = 16
  const popupGap = 8
  const preferredHeight = 344
  const spaceAbove = Math.max(0, trigger.top - viewportMargin - popupGap)
  const spaceBelow = Math.max(0, viewportHeight - trigger.bottom - viewportMargin - popupGap)
  const placement = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove ? 'bottom' : 'top'
  return {
    placement,
    maxHeight: Math.min(preferredHeight, placement === 'bottom' ? spaceBelow : spaceAbove)
  }
}

function DesignStylePicker({
  value,
  disabled,
  onChange
}: {
  value: DesignSystemPreset
  disabled: boolean
  onChange?: (preset: DesignSystemPreset) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [popupLayout, setPopupLayout] = useState<{
    placement: DesignStylePopupPlacement
    maxHeight: number
  }>({ placement: 'bottom', maxHeight: 344 })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const labelId = useId()
  const listboxId = useId()
  const selectedIndex = Math.max(0, DESIGN_SYSTEM_PRESETS.indexOf(value))
  const selectedLabel = value === 'none'
    ? t('designStyleAuto', { defaultValue: 'Auto' })
    : DESIGN_SYSTEM_DISPLAY[value]

  const updatePopupLayout = useCallback((): void => {
    const trigger = triggerRef.current?.getBoundingClientRect()
    if (!trigger) return
    setPopupLayout(resolveDesignStylePopupLayout(trigger, window.innerHeight))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handlePointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const detailsElement = rootRef.current?.closest('details')
    const handleDetailsToggle = (): void => {
      if (!detailsElement?.open) setOpen(false)
    }
    updatePopupLayout()
    document.addEventListener('pointerdown', handlePointerDown)
    detailsElement?.addEventListener('toggle', handleDetailsToggle)
    window.addEventListener('resize', updatePopupLayout)
    window.addEventListener('scroll', updatePopupLayout, true)
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus())
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      detailsElement?.removeEventListener('toggle', handleDetailsToggle)
      window.removeEventListener('resize', updatePopupLayout)
      window.removeEventListener('scroll', updatePopupLayout, true)
      window.cancelAnimationFrame(frame)
    }
  }, [open, selectedIndex, updatePopupLayout])

  const closeAndFocusTrigger = (): void => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const selectPreset = (preset: DesignSystemPreset): void => {
    onChange?.(preset)
    closeAndFocusTrigger()
  }

  const focusOption = (index: number): void => {
    const count = DESIGN_SYSTEM_PRESETS.length
    optionRefs.current[(index + count) % count]?.focus()
  }

  return (
    <div ref={rootRef} className="relative grid gap-1" data-design-style-picker>
      <span id={labelId} className="text-[11.5px] font-medium text-ds-muted">
        {t('designStyle', { defaultValue: 'Design style' })}
      </span>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || !onChange}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-labelledby={labelId}
        onClick={() => {
          if (!open) updatePopupLayout()
          setOpen((current) => !current)
        }}
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          if (!open) setOpen(true)
          const nextIndex = event.key === 'End'
            ? DESIGN_SYSTEM_PRESETS.length - 1
            : event.key === 'Home'
              ? 0
              : selectedIndex
          window.requestAnimationFrame(() => focusOption(nextIndex))
        }}
        className={`flex h-9 w-full items-center justify-between rounded-xl border bg-ds-surface-subtle px-3 text-left text-[12px] font-medium outline-none transition disabled:cursor-not-allowed disabled:opacity-60 ${
          open
            ? 'border-[#788bff] text-ds-ink shadow-[0_0_0_3px_rgba(107,124,255,0.12)]'
            : 'border-ds-border-muted text-ds-muted hover:border-ds-border-strong hover:text-ds-ink focus-visible:border-[#788bff] focus-visible:shadow-[0_0_0_3px_rgba(107,124,255,0.12)]'
        }`}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${open ? 'rotate-180' : ''}`} strokeWidth={1.8} />
      </button>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className={`absolute left-0 z-[60] w-full overflow-y-auto overscroll-contain rounded-[18px] border border-ds-border-muted bg-white p-2.5 shadow-[0_20px_55px_rgba(15,23,42,0.16),0_4px_14px_rgba(15,23,42,0.07)] dark:bg-ds-card ${
            popupLayout.placement === 'top'
              ? 'bottom-[calc(100%+8px)]'
              : 'top-[calc(100%+8px)]'
          }`}
          style={{ maxHeight: popupLayout.maxHeight }}
          data-placement={popupLayout.placement}
          data-design-style-listbox
          onKeyDown={(event) => {
            const currentIndex = optionRefs.current.indexOf(document.activeElement as HTMLButtonElement)
            if (event.key === 'Escape') {
              event.preventDefault()
              closeAndFocusTrigger()
              return
            }
            if (event.key === 'Tab') {
              setOpen(false)
              return
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              selectPreset(DESIGN_SYSTEM_PRESETS[Math.max(0, currentIndex)])
              return
            }
            const nextIndex = event.key === 'ArrowRight'
              ? currentIndex + 1
              : event.key === 'ArrowLeft'
                ? currentIndex - 1
                : event.key === 'ArrowDown'
                  ? currentIndex + 2
                  : event.key === 'ArrowUp'
                    ? currentIndex - 2
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? DESIGN_SYSTEM_PRESETS.length - 1
                        : null
            if (nextIndex === null) return
            event.preventDefault()
            focusOption(nextIndex)
          }}
        >
          <div className="sticky top-0 z-10 -mx-0.5 flex items-center justify-between bg-white/95 px-1.5 pb-2 text-[10.5px] font-semibold text-ds-faint backdrop-blur-sm dark:bg-ds-card/95">
            <span>{t('designStylePickerTitle', { defaultValue: 'Choose design style' })}</span>
            <span>
              {t('designStyleOptionCount', {
                defaultValue: '{{count}} options',
                count: DESIGN_SYSTEM_PRESETS.length
              })}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {DESIGN_SYSTEM_PRESETS.map((preset, index) => {
              const selected = preset === value
              return (
                <button
                  key={preset}
                  ref={(element) => { optionRefs.current[index] = element }}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  title={preset === 'none'
                    ? t('designStyleAuto', { defaultValue: 'Auto' })
                    : DESIGN_SYSTEM_DISPLAY[preset]}
                  onClick={() => selectPreset(preset)}
                  className={`group flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-[#788bff]/40 ${
                    selected
                      ? 'bg-[#eef0ff] text-[#5558e8] shadow-[inset_0_0_0_1px_rgba(91,92,240,0.08)] dark:bg-indigo-400/15 dark:text-indigo-300'
                      : 'text-ds-ink hover:bg-ds-hover'
                  }`}
                >
                  <DesignStyleMark preset={preset} />
                  <span className="min-w-0 flex-1 truncate">
                    {preset === 'none'
                      ? t('designStyleAuto', { defaultValue: 'Auto' })
                      : DESIGN_SYSTEM_DISPLAY[preset]}
                  </span>
                  {selected ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[9.5px] font-semibold">
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#6267ee] text-white">
                        <Check className="h-2.5 w-2.5" strokeWidth={2.6} />
                      </span>
                      <span className="hidden min-[1180px]:inline">
                        {t('designStyleCurrent', { defaultValue: 'Current' })}
                      </span>
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Turn intent and immutable Design profile controls rendered outside the input surface. */
export function FloatingComposerTaskProfile({
  surface,
  locked,
  profileLocked = false,
  disabled = false,
  profile,
  imageGenerationEnabled,
  imageGenerationAvailable,
  imageGenerationReason,
  onSurfaceChange,
  onProfileChange,
  onConfigureImageGeneration
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const profileControlsDisabled = disabled || profileLocked
  const profileImmutable = locked || profileLocked
  const imageGenerationStateKnown = imageGenerationEnabled !== undefined
  const imageGenerationFeatureEnabled = imageGenerationEnabled ?? imageGenerationAvailable
  const selectedImageAwaitingCapability =
    !imageGenerationStateKnown && profile.outputMedium === 'image'
  const effectiveOutputMedium: DesignTaskOutputMedium =
    !profileImmutable &&
    imageGenerationStateKnown &&
    !imageGenerationFeatureEnabled &&
    profile.outputMedium === 'image'
      ? 'html'
      : profile.outputMedium
  const showImageGenerationOption =
    imageGenerationFeatureEnabled ||
    selectedImageAwaitingCapability ||
    (profileImmutable && profile.outputMedium === 'image')
  const imageUnavailable = !imageGenerationAvailable
  const outputOptions: [
    ComposerProfileSelectOption<DesignTaskOutputMedium>,
    ...Array<ComposerProfileSelectOption<DesignTaskOutputMedium>>
  ] = [
    {
      value: 'html',
      label: t('designOutputHtml', { defaultValue: 'HTML design' }),
      icon: PanelsTopLeft,
      iconClassName: 'bg-violet-50 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300'
    }
  ]
  if (showImageGenerationOption) {
    outputOptions.push({
      value: 'image',
      label: t('designOutputImage', { defaultValue: 'AI image' }),
      icon: Image,
      iconClassName: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-300',
      disabled: imageUnavailable
    })
  }
  const summaryOutputLabel = showImageGenerationOption
    ? t(
        profile.outputMedium === 'image' ? 'designOutputImage' : 'designOutputHtml',
        { defaultValue: profile.outputMedium === 'image' ? 'AI image' : 'HTML design' }
      )
    : t('designOutputHtml', { defaultValue: 'HTML design' })
  const summaryOptions = showImageGenerationOption
    ? outputOptions
    : [outputOptions[0]]
  const summaryLabel = t(
    profile.target === 'app' ? 'designTargetApp' : 'designTargetWeb',
    { defaultValue: profile.target === 'app' ? 'App' : 'Web' }
  )
  const presetLabel = profile.preset === 'none'
    ? t('designStyleAuto', { defaultValue: 'Auto' })
    : DESIGN_SYSTEM_DISPLAY[profile.preset]

  return (
    <div
      className="ds-composer-task-profile ds-no-drag flex min-w-0 flex-wrap items-center gap-2 px-1"
      data-task-surface={surface}
      data-task-surface-locked={locked ? 'true' : 'false'}
    >
      {surface === 'design' ? (
        <DesignProfileSummary
          disabled={disabled}
          locked={locked}
          profileLocked={profileLocked}
          outputOptions={summaryOptions}
          effectiveOutputMedium={effectiveOutputMedium}
          outputLabel={summaryOutputLabel}
          targetLabel={summaryLabel}
          presetLabel={presetLabel}
          profile={profile}
          imageGenerationStateKnown={imageGenerationStateKnown}
          imageGenerationAvailable={imageGenerationAvailable}
          imageGenerationReason={imageGenerationReason}
          onProfileChange={onProfileChange}
          onConfigureImageGeneration={onConfigureImageGeneration}
        />
      ) : null}
    </div>
  )
}
