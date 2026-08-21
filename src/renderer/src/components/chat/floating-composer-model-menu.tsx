import type { CSSProperties, Dispatch, ReactElement, RefObject, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { TFunction } from 'i18next'
import { Brain, Gauge, Search } from 'lucide-react'
import { modelSupportsImageInput } from '@shared/app-settings-provider-core'
import { ProviderIcon } from '../provider-icon'
import {
  UNGROUPED_MODEL_PROVIDER_ID,
  composerModelMenuItemSelected,
  modelProfileForModel,
  type ComposerModelMenuGroup,
  type ComposerReasoningEffort
} from './floating-composer-model-picker-logic'
import { MenuSectionTitle, MenuSeparator, ModelCapabilityBadge, PickerRow, ProviderRow, SubmenuRow } from './floating-composer-model-picker-rows'

type ComposerModelMenuProps = {
  className: string
  menuOpen: boolean
  canOpenModelControls: boolean
  menuRef: RefObject<HTMLDivElement | null>
  menuStyle: CSSProperties
  controlVariant: 'combined' | 'split'
  reasoningEnabled: boolean
  needsProviderSetup: boolean
  reasoningRowRef: RefObject<HTMLButtonElement | null>
  reasoningPanelOpen: boolean
  setActiveProviderId: Dispatch<SetStateAction<string | null>>
  setReasoningPanelOpen: Dispatch<SetStateAction<boolean>>
  t: TFunction<'common'>
  currentReasoningLabel: string
  providerMenuGroups: ComposerModelMenuGroup[]
  onConfigureProviders?: () => void
  setMenuOpen: Dispatch<SetStateAction<boolean>>
  selectedProviderId: string | null
  currentModel: string
  providerRowRefs: RefObject<Map<string, HTMLButtonElement>>
  activeProviderId: string | null
  submenuRef: RefObject<HTMLDivElement | null>
  submenuStyle: CSSProperties
  reasoningOptions: Array<{ id: ComposerReasoningEffort; labelKey: string }>
  currentReasoning: ComposerReasoningEffort
  onComposerReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
  activeProviderGroup: ComposerModelMenuGroup | null | undefined
  modelFilter: string
  setModelFilter: Dispatch<SetStateAction<string>>
  activeProviderModelIds: string[]
  onComposerModelChange: (modelId: string, providerId?: string) => void
  setReasoningPopoverOpen: Dispatch<SetStateAction<boolean>>
}

export function renderComposerModelMenu({
  className,
  ...props
}: ComposerModelMenuProps): ReactElement | null {
  const {
    menuOpen, canOpenModelControls, menuRef, menuStyle, controlVariant,
    reasoningEnabled, needsProviderSetup, reasoningRowRef, reasoningPanelOpen,
    setActiveProviderId, setReasoningPanelOpen, t, currentReasoningLabel,
    providerMenuGroups, onConfigureProviders, setMenuOpen, selectedProviderId,
    currentModel, providerRowRefs, activeProviderId, submenuRef, submenuStyle,
    reasoningOptions, currentReasoning, onComposerReasoningEffortChange,
    activeProviderGroup, modelFilter, setModelFilter, activeProviderModelIds,
    onComposerModelChange, setReasoningPopoverOpen
  } = props
    if (!menuOpen || !canOpenModelControls) return null
    const menu = (
      <>
        <div
          ref={menuRef}
          role="menu"
          style={menuStyle}
          className={className}
        >
          {controlVariant === 'combined' && reasoningEnabled && !needsProviderSetup ? (
            <>
              <SubmenuRow
                refNode={(node) => {
                  reasoningRowRef.current = node
                }}
                active={reasoningPanelOpen}
                selected={false}
                icon={<Brain className="h-4 w-4 shrink-0 text-ds-faint" strokeWidth={1.9} />}
                title={t('composerReasoning')}
                subtitle={currentReasoningLabel}
                onClick={() => {
                  setActiveProviderId(null)
                  setReasoningPanelOpen((open) => !open)
                }}
                onMouseEnter={() => {
                  setActiveProviderId(null)
                  setReasoningPanelOpen(true)
                }}
              />
              <MenuSeparator />
            </>
          ) : null}

          <MenuSectionTitle icon={<Gauge className="h-3.5 w-3.5" strokeWidth={1.9} />}>
            {t('composerModel')}
          </MenuSectionTitle>
          <div className="pr-0.5">
            {needsProviderSetup ? (
              <div className="px-2.5 py-2">
                <p className="text-[12.5px] leading-5 text-ds-muted">
                  {t('composerNoProviders')}
                </p>
                {onConfigureProviders ? (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onConfigureProviders()
                    }}
                    className="mt-2 flex w-full items-center justify-center rounded-lg border border-ds-border bg-ds-surface-subtle px-3 py-2 text-[12.5px] font-semibold text-ds-ink transition hover:bg-ds-hover"
                  >
                    {t('composerConfigureProviders')}
                  </button>
                ) : null}
              </div>
            ) : (
              providerMenuGroups.map((group) => {
                const selectedModel = composerModelMenuItemSelected({
                  groupProviderId: group.providerId,
                  selectedProviderId,
                  currentModel,
                  modelId: currentModel
                })
                  ? currentModel
                  : ''
                return (
                  <ProviderRow
                    key={group.providerId}
                    refNode={(node) => {
                      if (node) providerRowRefs.current.set(group.providerId, node)
                      else providerRowRefs.current.delete(group.providerId)
                    }}
                    active={activeProviderId === group.providerId}
                    selected={selectedProviderId === group.providerId}
                    icon={(
                      <ProviderIcon
                        presetId={group.presetSource}
                        providerId={group.providerId}
                        className="h-4 w-4 text-ds-faint"
                      />
                    )}
                    title={group.label}
                    subtitle={selectedModel}
                    onClick={() => {
                      setReasoningPanelOpen(false)
                      setActiveProviderId(group.providerId)
                    }}
                    onMouseEnter={() => {
                      setReasoningPanelOpen(false)
                      setActiveProviderId(group.providerId)
                    }}
                  />
                )
              })
            )}
          </div>
        </div>
        {controlVariant === 'combined' && reasoningPanelOpen && reasoningEnabled ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={t('composerReasoning')}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerReasoning')}
            </div>
            <div className="flex flex-col gap-1">
              {reasoningOptions.map((option) => (
                <PickerRow
                  key={option.id}
                  selected={currentReasoning === option.id}
                  title={t(option.labelKey)}
                  onClick={() => {
                    onComposerReasoningEffortChange?.(option.id)
                    setMenuOpen(false)
                  }}
                />
              ))}
            </div>
          </div>
        ) : activeProviderGroup ? (
          <div
            ref={submenuRef}
            role="menu"
            aria-label={activeProviderGroup.label}
            style={submenuStyle}
            className="fixed z-[1001] overflow-y-auto rounded-xl border border-ds-border bg-white p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] dark:bg-ds-card"
          >
            <div className="px-2.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ds-faint">
              {t('composerModel')}
            </div>
            <label className="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-surface-subtle px-2 text-ds-faint">
              <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <input
                type="search"
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                placeholder={t('composerModelSearchPlaceholder')}
                className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] font-medium text-ds-ink outline-none placeholder:text-ds-faint"
              />
            </label>
            {activeProviderModelIds.length > 0 ? (
              activeProviderModelIds.map((id) => {
                const targetProfile = modelProfileForModel(activeProviderGroup, id)
                const selected = composerModelMenuItemSelected({
                  groupProviderId: activeProviderGroup.providerId,
                  selectedProviderId,
                  currentModel,
                  modelId: id
                })
                return (
                  <PickerRow
                    key={`${activeProviderGroup.providerId}:${id}`}
                    selected={selected}
                    title={id}
                    rightSlot={
                      modelSupportsImageInput(targetProfile)
                        ? <ModelCapabilityBadge kind="vision" label={t('composerModelVision')} />
                        : <ModelCapabilityBadge kind="text" label={t('composerModelTextOnly')} />
                    }
                    onClick={() => {
                      onComposerModelChange(
                        id,
                        activeProviderGroup.providerId === UNGROUPED_MODEL_PROVIDER_ID
                          ? undefined
                          : activeProviderGroup.providerId
                      )
                      setReasoningPopoverOpen(false)
                      setMenuOpen(false)
                    }}
                  />
                )
              })
            ) : (
              <div className="px-2.5 py-2 text-[12.5px] font-medium text-ds-faint">
                {t('composerNoMatchingModels')}
              </div>
            )}
          </div>
        ) : null}
      </>
    )

    if (typeof document === 'undefined') return menu
    return createPortal(menu, document.body)
}
