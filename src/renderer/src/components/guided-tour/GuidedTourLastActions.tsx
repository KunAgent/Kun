import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Briefcase, ChevronRight, Cloud, Code2, FilePlus2, Import, ListChecks, MessageCirclePlus, MessagesSquare, PenLine, Search, Wrench } from 'lucide-react'
import { COMPOSER_PREFILL_EVENT, type ComposerPrefillDetail } from '../../artifacts/composer-prefill'
import { FirstTaskGuide } from '../../product-analytics/FirstTaskGuide'
import { createWorkDraftDocument, openPaperImport } from '../../write/work-session-actions'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'
import { openAddAssistantDialog } from '../assistants/assistant-navigation'
import { openCurrentWhatsNew } from '../whats-new/whats-new-store'
import { useGuidedTourStore } from './guided-tour-store'
import { openGuidedMode, type GuidedModeTourId, type GuidedTourId } from './guided-tour-steps'

/** Fills the open composer without sending; the user reads it and presses send. */
function prefillComposer(text: string): void {
  window.dispatchEvent(new CustomEvent<ComposerPrefillDetail>(COMPOSER_PREFILL_EVENT, { detail: { text } }))
  window.setTimeout(() => {
    document.querySelector<HTMLTextAreaElement>('[data-floating-composer] textarea')?.focus()
  }, 80)
}

function Starter({ id, icon, title, sub, onClick }: {
  id: string
  icon: ReactNode
  title: string
  sub?: string
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" className="guided-tour-starter" data-guided-tour-starter={id} onClick={onClick}>
      <span className="guided-tour-starter-icon">{icon}</span>
      <span className="guided-tour-starter-text">
        <span className="guided-tour-starter-title">{title}</span>
        {sub ? <span className="guided-tour-starter-sub">{sub}</span> : null}
      </span>
      <ChevronRight size={14} strokeWidth={2} className="guided-tour-starter-chevron" aria-hidden="true" />
    </button>
  )
}

function Foot({ onBack, children }: { onBack?: () => void; children: ReactNode }): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="guided-tour-pop-foot">
      {onBack ? <button type="button" className="guided-tour-text-button" onClick={onBack}>{t('guidedTourPrev')}</button> : null}
      <span className="guided-tour-foot-spacer" />
      {children}
    </div>
  )
}

const icon = { size: 15, strokeWidth: 1.9, 'aria-hidden': true } as const

/** The overview ends by choosing a mode; that mode's own tour starts once it is on screen. */
function OverviewActions({ onBack }: { onBack?: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const notes = useGuidedTourStore((s) => s.releaseNotesWaiting)
  const pick = (mode: GuidedModeTourId): void => {
    const store = useGuidedTourStore.getState()
    store.request(mode)
    store.close()
    openGuidedMode(mode)
  }
  return (
    <>
      <p className="guided-tour-pick-label">{t('guidedTour_overview_pick')}</p>
      <div className="guided-tour-modes">
        <button type="button" className="guided-tour-mode" data-guided-tour-pick="code" onClick={() => pick('code')}>
          <Code2 {...icon} /><span>{t('code')}</span>
        </button>
        <button type="button" className="guided-tour-mode" data-guided-tour-pick="work" onClick={() => pick('work')}>
          <Briefcase {...icon} /><span>{t('workspaceModeWorkLabel')}</span>
        </button>
        <button type="button" className="guided-tour-mode" data-guided-tour-pick="chats" onClick={() => pick('chats')}>
          <MessagesSquare {...icon} /><span>{t('workspaceModeChatsLabel')}</span>
        </button>
      </div>
      <Foot onBack={onBack}>
        {notes ? (
          <button type="button" className="guided-tour-text-button is-accent" data-guided-tour-release-notes
            onClick={() => { useGuidedTourStore.getState().close(); void openCurrentWhatsNew() }}>
            {t('guidedTour_overview_notes')}
          </button>
        ) : null}
        <button type="button" className="guided-tour-button is-small" data-guided-tour-primary="true"
          onClick={() => useGuidedTourStore.getState().close()}>
          {t('guidedTour_overview_stay')}
        </button>
      </Foot>
    </>
  )
}

function CodeActions({ onBack }: { onBack?: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const run = (prompt: string) => () => { useGuidedTourStore.getState().close(); prefillComposer(prompt) }
  return (
    <>
      <div className="guided-tour-starters">
        <Starter id="explain" icon={<Search {...icon} />} title={t('guidedTour_code_starterExplain')}
          onClick={run(t('guidedTour_code_starterExplainPrompt'))} />
        <Starter id="fix" icon={<Wrench {...icon} />} title={t('guidedTour_code_starterFix')}
          onClick={run(t('guidedTour_code_starterFixPrompt'))} />
        <Starter id="plan" icon={<ListChecks {...icon} />} title={t('guidedTour_code_starterPlan')}
          onClick={run(t('guidedTour_code_starterPlanPrompt'))} />
      </div>
      <FirstTaskGuide beforeNavigate={() => useGuidedTourStore.getState().close()} />
      <Foot onBack={onBack}>
        <button type="button" className="guided-tour-button is-primary is-small" data-guided-tour-primary="true"
          onClick={() => useGuidedTourStore.getState().close()}>{t('guidedTourFinish')}</button>
      </Foot>
    </>
  )
}

function WorkActions({ onBack }: { onBack?: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const close = (): void => useGuidedTourStore.getState().close()
  return (
    <>
      <div className="guided-tour-starters">
        <Starter id="report" icon={<PenLine {...icon} />} title={t('guidedTour_work_starterReport')}
          sub={t('guidedTour_work_starterReportSub')}
          onClick={() => { close(); prefillComposer(t('guidedTour_work_starterReportPrompt')) }} />
        <Starter id="paper" icon={<Import {...icon} />} title={t('guidedTour_work_starterPaper')}
          sub={t('guidedTour_work_starterPaperSub')} onClick={() => { close(); void openPaperImport() }} />
        <Starter id="document" icon={<FilePlus2 {...icon} />} title={t('guidedTour_work_starterDocument')}
          onClick={() => { close(); void createWorkDraftDocument(t('writeUntitledDraft')) }} />
      </div>
      <Foot onBack={onBack}>
        <button type="button" className="guided-tour-button is-primary is-small" data-guided-tour-primary="true"
          onClick={close}>{t('guidedTourFinish')}</button>
      </Foot>
    </>
  )
}

/** 对话 is the same kind of thing as a personal-assistant Bot in an IM app, used locally. */
function ChatsActions({ onBack }: { onBack?: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const close = (): void => useGuidedTourStore.getState().close()
  const rows = ['talk', 'memory', 'schedule', 'results'] as const
  return (
    <>
      <div className="guided-tour-compare" role="table" aria-label={t('guidedTour_chats_bot_title')}>
        <div role="row" className="is-head">
          <span role="columnheader">{t('guidedTour_chats_compareBot')}</span>
          <span role="columnheader">{t('guidedTour_chats_compareLocal')}</span>
        </div>
        {rows.map((row) => (
          <div role="row" key={row}>
            <span role="cell">{t(`guidedTour_chats_compare_${row}_bot`)}</span>
            <span role="cell">{t(`guidedTour_chats_compare_${row}_local`)}</span>
          </div>
        ))}
      </div>
      <Foot onBack={onBack}>
        <button type="button" className="guided-tour-button is-small" data-guided-tour-starter="assistant"
          onClick={() => { close(); openAddAssistantDialog() }}>
          <Cloud size={13} strokeWidth={1.9} aria-hidden="true" />{t('assistantAddMenu')}
        </button>
        <button type="button" className="guided-tour-button is-primary is-small" data-guided-tour-primary="true"
          data-guided-tour-starter="chat" onClick={() => { close(); openAgentChatDialog('picker') }}>
          <MessageCirclePlus size={13} strokeWidth={1.9} aria-hidden="true" />{t('agentChatsStart')}
        </button>
      </Foot>
    </>
  )
}

export function GuidedTourLastActions({ tour, onBack }: { tour: GuidedTourId; onBack?: () => void }): ReactElement {
  switch (tour) {
    case 'overview': return <OverviewActions onBack={onBack} />
    case 'code': return <CodeActions onBack={onBack} />
    case 'work': return <WorkActions onBack={onBack} />
    case 'chats': return <ChatsActions onBack={onBack} />
  }
}
