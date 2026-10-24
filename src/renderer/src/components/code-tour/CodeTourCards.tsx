import { FirstTaskGuide } from '../../product-analytics/FirstTaskGuide'
import { useState, type ReactElement, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FolderOpen, MessageCircle, Search, Wrench } from 'lucide-react'
import kunGreetUrl from '../../../../asset/img/kun_greet.png'
import kunCheerUrl from '../../../../asset/img/kun_cheer.png'
import { useChatStore } from '../../store/chat-store'
import { effectiveCodeWorkspaceRoot } from '../../lib/removed-code-workspaces'
import { isDefaultWorkspacePath, workspaceLabelFromPath } from '../../lib/workspace-label'
import { openAgentChatDialog } from '../rooms/agent-chat-picker'

/** Home folder shortened to `~`, the way the project menu shows parents. */
export function displayPath(root: string): string {
  return root.replace(/\\/g, '/')
    .replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\/Users\/[^/]+/, '~')
}

/** The project new tasks start in; the default and conversation folders do not count as one. */
function useTourProject(): { root: string; label: string; isProject: boolean } {
  const { workspaceRoot, conversationWorkspaceRoot, removedCodeWorkspaces } = useChatStore(useShallow((s) => ({
    workspaceRoot: s.workspaceRoot,
    conversationWorkspaceRoot: s.conversationWorkspaceRoot,
    removedCodeWorkspaces: s.removedCodeWorkspaces
  })))
  const root = effectiveCodeWorkspaceRoot(workspaceRoot, removedCodeWorkspaces)
  const isProject = Boolean(root) && !isDefaultWorkspacePath(root) &&
    root.replace(/[/\\]+$/, '') !== conversationWorkspaceRoot.replace(/[/\\]+$/, '')
  return { root, label: root ? workspaceLabelFromPath(root) : '', isProject }
}

function TourButton({ primary = false, onClick, children, autoFocus = false }: {
  primary?: boolean
  onClick: () => void
  children: ReactNode
  autoFocus?: boolean
}): ReactElement {
  return (
    <button type="button" className={`code-tour-button ${primary ? 'is-primary' : ''}`}
      data-code-tour-primary={primary ? 'true' : undefined} autoFocus={autoFocus} onClick={onClick}>
      {children}
    </button>
  )
}

export function CodeTourWelcome({ stepCount, onStart, onSkip }: {
  stepCount: number
  onStart: () => void
  onSkip: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const project = useTourProject()
  const chooseWorkspace = useChatStore((s) => s.chooseWorkspace)
  const [picking, setPicking] = useState(false)

  const pickFolder = async (): Promise<void> => {
    if (picking) return
    setPicking(true)
    try {
      await chooseWorkspace({ createThreadAfter: false, selectThreadAfter: false })
    } finally {
      setPicking(false)
    }
  }

  return (
    <section className="code-tour-welcome" role="dialog" aria-modal="true" aria-labelledby="code-tour-welcome-title">
      <div className="code-tour-stage" aria-hidden="true">
        <span className="code-tour-stage-glow" />
        <span className="code-tour-stage-wave" />
        <p className="code-tour-bubble">{t('codeTourBubble')}</p>
        <img src={kunGreetUrl} alt="" className="code-tour-stage-art" draggable={false} />
      </div>
      <div className="code-tour-welcome-body">
        <span className="code-tour-eyebrow">{t('codeTourEyebrow')}</span>
        <h1 id="code-tour-welcome-title" className="code-tour-title">{t('codeTourWelcomeTitle')}</h1>
        <p className="code-tour-lead">{t('codeTourWelcomeLead')}</p>

        <div className="code-tour-project" data-code-tour-project={project.isProject ? 'project' : 'none'}>
          <span className="code-tour-project-icon"><FolderOpen size={20} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="code-tour-project-text">
            <span className="code-tour-project-head">
              <span className="code-tour-project-name">{project.isProject ? project.label : t('codeTourNoProject')}</span>
              {project.isProject ? <span className="code-tour-badge">{t('codeTourProjectCurrent')}</span> : null}
            </span>
            {project.isProject ? (
              <span className="code-tour-project-path" title={project.root}>{displayPath(project.root)}</span>
            ) : null}
            <span className="code-tour-project-contents">
              {t(project.isProject ? 'codeTourProjectNote' : 'codeTourNoProjectNote')}
            </span>
            <button type="button" className="code-tour-link" disabled={picking} onClick={() => void pickFolder()}>
              {t(project.isProject ? 'codeTourChangeProject' : 'codeTourOpenProject')}
            </button>
          </span>
        </div>

        <div className="code-tour-welcome-foot">
          <span className="code-tour-foot-hint">{t('codeTourEscHint')}</span>
          <TourButton onClick={onSkip}>{t('codeTourSkipAll')}</TourButton>
          {stepCount > 0 ? (
            <TourButton primary autoFocus onClick={onStart}>{t('codeTourStart', { steps: stepCount })}</TourButton>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function Starter({ kind, icon, title, sub, onClick }: {
  kind: string
  icon: ReactNode
  title: string
  sub: string
  onClick: () => void
}): ReactElement {
  return (
    <button type="button" className="code-tour-starter" data-code-tour-starter={kind} onClick={onClick}>
      <span className={`code-tour-starter-icon is-${kind}`}>{icon}</span>
      <span className="code-tour-starter-text">
        <span className="code-tour-starter-title">{title}</span>
        <span className="code-tour-starter-sub">{sub}</span>
      </span>
      <ChevronRight size={15} strokeWidth={2} className="code-tour-starter-chevron" aria-hidden="true" />
    </button>
  )
}

/**
 * Ways to begin. Each one fills the composer or opens the Agent picker and
 * closes the tour; nothing is sent on the user's behalf.
 */
export function CodeTourDone({ onClose, onPrefill }: {
  onClose: () => void
  onPrefill: (prompt: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const project = useTourProject()
  return (
    <section className="code-tour-done" role="dialog" aria-modal="true" aria-labelledby="code-tour-done-title">
      <img src={kunCheerUrl} alt="" className="code-tour-done-art" draggable={false} />
      <h2 id="code-tour-done-title" className="code-tour-title">{t('codeTourDoneTitle')}</h2>
      <p className="code-tour-lead">
        {project.isProject ? t('codeTourDoneLead', { project: project.label }) : t('codeTourDoneLeadNoProject')}
      </p>
      <div className="code-tour-starters">
        <Starter kind="explain" icon={<Search size={17} strokeWidth={1.9} aria-hidden="true" />}
          title={t('codeTourStarterExplain')} sub={t('codeTourStarterExplainSub')}
          onClick={() => { onClose(); onPrefill(t('codeTourStarterExplainPrompt')) }} />
        <Starter kind="fix" icon={<Wrench size={17} strokeWidth={1.9} aria-hidden="true" />}
          title={t('codeTourStarterFix')} sub={t('codeTourStarterFixSub')}
          onClick={() => { onClose(); onPrefill(t('codeTourStarterFixPrompt')) }} />
        <Starter kind="chat" icon={<MessageCircle size={17} strokeWidth={1.9} aria-hidden="true" />}
          title={t('codeTourStarterChat')} sub={t('codeTourStarterChatSub')}
          onClick={() => { onClose(); openAgentChatDialog('picker') }} />
      </div>
      <TourButton primary autoFocus onClick={onClose}>{t('codeTourExplore')}</TourButton>
      <span className="code-tour-foot-hint">{t('codeTourReplayHint')}</span>
      <FirstTaskGuide beforeNavigate={onClose} />
    </section>
  )
}
