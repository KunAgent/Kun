// Real research view and FloatingComposer. Only the assistant session/provider data are synthetic.
import { useState, type ReactElement } from 'react'
import { WriteAssistantStageContext, type WriteAssistantStageProps } from '../../src/renderer/src/components/write/WriteAssistantStageContext'
import { PaperResearchView } from '../../src/renderer/src/components/paper/research/PaperResearchView'
import { useWriteWorkspaceStore } from '../../src/renderer/src/write/write-workspace-store'

export function PaperWorkspaceFixtureResearch(): ReactElement {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'agent' | 'plan' | 'auto'>('agent')
  const [model, setModel] = useState('offline-model')
  const [effort, setEffort] = useState<WriteAssistantStageProps['composerReasoningEffort']>('medium')
  const [fast, setFast] = useState(false)
  const noop = () => undefined
  const assistant: WriteAssistantStageProps = {
    input, setInput, mode, setMode, busy: false, runtimeConnection: 'ready',
    activeThreadId: null, blocks: [], liveReasoning: '', liveAssistant: '',
    composerModel: model, composerProviderId: 'offline-provider', composerPickList: ['offline-model'],
    composerModelGroups: [], skillCommands: [], disabledSkillIds: [],
    composerReasoningEffort: effort, composerFastMode: fast,
    setComposerModel: setModel, setComposerReasoningEffort: setEffort, setComposerFastMode: setFast,
    queuedMessages: [], removeQueuedMessage: noop, guideQueuedMessage: noop,
    onSend: () => { throw Error('Offline fixture must not submit model requests') },
    onInterrupt: noop, onRetryConnection: noop, onOpenSettings: noop, onConfigureProviders: noop,
    onNewConversation: noop, onPickWorkspace: noop, onCollapse: noop
  }
  return <WriteAssistantStageContext.Provider value={assistant}>
    <PaperResearchView onShowDirect={() => useWriteWorkspaceStore.getState().openPaperViewTab('library')} />
  </WriteAssistantStageContext.Provider>
}
