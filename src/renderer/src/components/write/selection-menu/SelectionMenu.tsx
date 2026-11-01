import { useEffect, useState, type ReactElement } from 'react'
import { AlignLeft, AppWindow, ImageIcon, LayoutTemplate, LockKeyhole, MessageCircleQuestion, MessageSquare, MessageSquareQuote, PenLine, Sparkle } from 'lucide-react'
import { SelectionActionStrip } from './SelectionActionStrip'
import { useTranslation } from 'react-i18next'
import { MenuButton } from './MenuButton'
import { BlockTypeFlyout } from './BlockTypeFlyout'
import { FormatGrid } from './FormatGrid'
import { AgentDropdown } from './AgentDropdown'
import { AskField } from './AskField'
import { modifierLabel } from './shortcut-label'
import { navigateMenu } from './MenuFlyout'
import type { SelectionMenuProps } from './menu-types'

export function SelectionMenu(props: SelectionMenuProps): ReactElement {
  const { t } = useTranslation('common')
  const [text, setText] = useState('')
  const typing = text.trim().length > 0
  const { imageMode = false, formattingEnabled, quickActions = [], editEnabled = formattingEnabled,
    onDismiss, onReleaseSelection, onRestoreSelection } = props
  const canAsk = !imageMode && props.askEnabled !== false && Boolean(props.onAskEdit || props.onAskChat)
  const submit = (mode: 'edit' | 'chat'): void => {
    if (!text.trim()) return
    if (mode === 'edit' && editEnabled) props.onAskEdit?.(text.trim())
    else props.onAskChat?.(text.trim())
    onReleaseSelection?.(); setText('')
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== 'Escape' || event.isComposing) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input,textarea,[role="dialog"],.write-selection-menu-flyout')) return
      if (target !== document.body && !target?.closest('.write-selection-menu,.write-rich-editor,.write-codemirror-host,.write-workspace-view')) return
      event.preventDefault(); onDismiss?.(); onReleaseSelection?.()
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [onDismiss, onReleaseSelection])
  const rows = imageMode ? [] : typing ? quickActions.filter((action) => action.label.toLocaleLowerCase().includes(text.trim().toLocaleLowerCase())) : quickActions
  const generated = [
    { enabled: !imageMode && props.infographicEnabled, run: props.onGenerateInfographic, label: 'writeInfographicGenerate', icon: ImageIcon },
    { enabled: props.designDraftEnabled, run: props.onGenerateDesignDraft, label: 'writeDesignDraftGenerate', icon: LayoutTemplate },
    { enabled: props.prototypeEnabled, run: props.onGeneratePrototype, label: 'writePrototypeGenerate', icon: AppWindow }
  ].filter((item) => item.enabled && item.run)
  // The four everyday moves sit on top as pills; the menu below keeps formatting and skills.
  const strip = !typing && !imageMode && (canAsk || props.onQuoteSelection)
  return <>
    {strip ? <SelectionActionStrip editEnabled={Boolean(editEnabled)} onAskEdit={canAsk ? props.onAskEdit : undefined}
      onAskChat={canAsk ? props.onAskChat : undefined} onQuoteSelection={props.onQuoteSelection}
      onDone={() => onReleaseSelection?.()} /> : null}
    <div role="menu" aria-label={t('writeSelectionSkills')} onKeyDown={navigateMenu}>
      {!typing && !imageMode && formattingEnabled && <>
        {props.onSetBlockType && <BlockTypeFlyout blockType={props.blockType} onSet={props.onSetBlockType} focusMode={props.focusMode} />}
        {props.onApplyFormat && <FormatGrid active={props.activeFormats} richMode={props.richMode} onApply={(kind) => {
          if (kind === 'link') onDismiss?.()
          props.onRestoreSelection?.(); props.onApplyFormat?.(kind)
        }} />}
        <div className="write-selection-menu-separator" />
      </>}
      {!strip && !typing && !imageMode && props.onQuoteSelection && <>
        <MenuButton role="menuitem" className="write-selection-menu-row" label={t('writeSelectionQuote')}
          onActivate={() => { props.onQuoteSelection?.(); onReleaseSelection?.() }}><MessageSquareQuote /><span>{t('writeSelectionQuote')}</span></MenuButton>
        <div className="write-selection-menu-separator" />
      </>}
      {typing ? <>
        <div className="write-selection-menu-heading">{t('writeSelectionAskGroup')}</div>
        {editEnabled && <MenuButton role="menuitem" className="write-selection-menu-row is-skill" label={t('writeSelectionAskEdit')}
          onActivate={() => submit('edit')}><PenLine aria-hidden="true" /><span>{t('writeSelectionAskEdit')}</span><kbd>↵</kbd></MenuButton>}
        <MenuButton role="menuitem" className="write-selection-menu-row is-skill" label={t('writeSelectionAskChat')}
          onActivate={() => submit('chat')}><MessageSquare /><span>{t('writeSelectionAskChat')}</span><kbd>{editEnabled ? `${modifierLabel()}↵` : '↵'}</kbd></MenuButton>
        {rows.length > 0 && <div className="write-selection-menu-heading">{t('writeSelectionMatchedSkills')}</div>}
      </> : <div className="write-selection-menu-heading"><span>{t('writeSelectionSkills')}</span>
        {!imageMode && (props.onSelectAgent || props.onOpenAgentSettings) && <AgentDropdown presets={props.agentPresets ?? []}
          active={props.activeAgentId ?? ''} onSelect={props.onSelectAgent} onManage={props.onOpenAgentSettings} focusMode={props.focusMode} />}
      </div>}
      {rows.map((action) => {
        const Icon = action.id === 'polish' ? PenLine : action.id === 'explain' ? MessageCircleQuestion : action.id === 'reformat' ? AlignLeft : Sparkle
        return <MenuButton key={action.id} role="menuitem" className="write-selection-menu-row is-skill" label={action.label}
          onActivate={() => { props.onQuickAction?.(action); onReleaseSelection?.() }}><Icon aria-hidden="true" /><span>{action.label}</span>
          <small className="write-selection-menu-trail">{t(action.mode === 'edit' ? 'writeSelectionTrailEdit' : 'writeSelectionTrailChat')}</small></MenuButton>
      })}
      {!typing && generated.map(({ label, icon: Icon, run }) => <MenuButton key={label} role="menuitem" className="write-selection-menu-row is-skill"
        label={t(label)} onActivate={() => run?.()}><Icon /><span>{t(label)}</span><small className="write-selection-menu-trail">{t('writeSelectionTrailInsert')}</small></MenuButton>)}
    </div>
    {canAsk && <AskField value={text} onChange={setText} onSubmit={submit} readOnly={!editEnabled}
      onFreeze={props.onFreezeSelection} onRelease={onReleaseSelection} onRestore={onRestoreSelection} />}
    {typing && <div className="write-selection-menu-hints">
      {editEnabled && <span><kbd>↵</kbd> {t('writeSelectionHintEdit')}</span>}
      <span><kbd>{editEnabled ? `${modifierLabel()}↵` : '↵'}</kbd> {t('writeSelectionHintChat')}</span><span><kbd>Esc</kbd> {t('writeSelectionHintClose')}</span>
    </div>}
    {props.readOnlyNote && !typing && <div className="write-selection-menu-note"><LockKeyhole />{t('writeSelectionReadOnlyNote')}</div>}
  </>
}
