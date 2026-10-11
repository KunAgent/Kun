import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { readMobilePage } from '../navigation/mobile-page'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'
import { readWriteDocumentSha256 } from '../../components/workbench/read-write-document-sha256'
import { workbenchWriteSourceReference } from '../../components/workbench/workbench-write-source-reference'
import { activeWriteResourceReference } from '../../components/workbench/workbench-write-resource-context'
import {
  createWriteTurnReferenceAttachments,
  mergeWriteComposerContexts
} from '../../write/write-turn-reference-context'
import {
  activeWorkWhiteboardComposerContexts,
  workWhiteboardAdvertisesCanvasTools,
  workWhiteboardAdvertisesExcalidrawTools,
  workWhiteboardMessageFence,
  workWhiteboardSnapshotMatches
} from '../../components/workbench/workbench-write-whiteboard-context'

export function useMobileWorkAssistantSend(): {
  sending: boolean
  error: string
  send: (text: string) => Promise<boolean>
} {
  const { t } = useTranslation('common')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const chat = useChatStore(useShallow((state) => ({
    activeThreadId: state.activeThreadId,
    runtimeConnection: state.runtimeConnection,
    ensureThread: state.ensureWriteThreadForWorkspace,
    createThread: state.createWriteThread,
    selectThread: state.selectWriteThread,
    sendMessage: state.sendMessage
  })))
  const send = async (text: string): Promise<boolean> => {
    const prompt = text.trim()
    if (!prompt || sending) return false
    const reject = (reason: string): false => { setError(reason); return false }
    if (chat.runtimeConnection !== 'ready') return reject(t('mobileWorkDocConnectionLost'))
    const work = useWriteWorkspaceStore.getState()
    const document = work.activeFilePath ? work.documentsByPath[work.activeFilePath] : null
    const whiteboard = work.activeWhiteboardId ? work.whiteboards[work.activeWhiteboardId] ?? null : null
    const quotedSelections = work.quotedSelections.map((selection) => ({
      ...selection,
      ...(selection.rects ? { rects: selection.rects.map((rect) => ({ ...rect })) } : {})
    }))
    if (!work.workspaceRoot || (!document && !whiteboard)) return reject(t('mobileWorkDocNotReady'))
    const sameResource = (): boolean => {
      const live = useWriteWorkspaceStore.getState()
      const page = readMobilePage(new URL(window.location.href))
      const resourceKey = whiteboard ? workWhiteboardResourceKey(whiteboard.id)
        : workFileResourceKey(work.workspaceRoot, work.activeFilePath!)
      return live.workspaceRoot === work.workspaceRoot &&
        live.activeFilePath === work.activeFilePath &&
        live.activeWhiteboardId === work.activeWhiteboardId &&
        page.kind === 'resource' && page.resourceKey === resourceKey
    }
    if (document && !['text', 'code'].includes(document.kind)) {
      setError(t('mobileWorkDocSemanticContextNeeded'))
      return false
    }
    setSending(true)
    setError('')
    try {
      if (document && !await work.saveAllDocuments(work.workspaceRoot)) {
        setError(t('mobileWorkDocSaveBeforeSend'))
        return false
      }
      if (!sameResource()) return reject(t('mobileWorkDocChanged'))
      let threadId = whiteboard?.threadId ?? null
      if (whiteboard && !threadId) {
        threadId = await chat.createThread(work.workspaceRoot, undefined, {
          title: whiteboard.title,
          titleAuto: false
        })
        if (!sameResource()) return reject(t('mobileWorkDocChanged'))
        if (threadId && !await work.bindWhiteboardThread(whiteboard.id, threadId)) {
          setError(t('mobileWorkDocBindBoardFailed'))
          return false
        }
      }
      threadId ??= await chat.ensureThread(work.workspaceRoot, work.activeFilePath ?? undefined)
      if (!threadId || !sameResource()) return reject(t('mobileWorkDocThreadNotReady'))
      if (useChatStore.getState().activeThreadId !== threadId) {
        await chat.selectThread(threadId, work.workspaceRoot, work.activeFilePath ?? undefined)
      }
      if (!sameResource() || useChatStore.getState().activeThreadId !== threadId) {
        return reject(t('mobileWorkDocThreadChanged'))
      }
      const whiteboardContexts = whiteboard
        ? await activeWorkWhiteboardComposerContexts(work.workspaceRoot, whiteboard, threadId, prompt)
        : []
      const referenceContexts = document ? await createWriteTurnReferenceAttachments({
        workspaceRoot: work.workspaceRoot,
        activeResource: activeWriteResourceReference(
          work.workspaceRoot, work.activeFilePath, document.kind
        ),
        selections: quotedSelections,
        retrieval: null,
        officeDocument: null,
        query: prompt
      }) : []
      const composerContexts = mergeWriteComposerContexts(
        [...whiteboardContexts, ...referenceContexts], [], []
      )
      if (whiteboard && !workWhiteboardSnapshotMatches(useWriteWorkspaceStore.getState(), {
        ...whiteboard, threadId
      })) {
        setError(t('mobileWorkDocBoardChanged'))
        return false
      }
      const expectedSha256 = document
        ? await readWriteDocumentSha256(work.workspaceRoot, work.activeFilePath)
        : undefined
      const model = work.assistantModel.trim()
      const providerId = work.assistantProviderId.trim()
      const fileReference = document
        ? workbenchWriteSourceReference(work.workspaceRoot, work.activeFilePath)
        : undefined
      if (!sameResource()) return reject(t('mobileWorkDocChanged'))
      const sent = await chat.sendMessage(prompt, 'agent', {
        expectedThreadId: threadId,
        agentSurface: 'write',
        ...(model ? { model } : {}),
        ...(providerId ? { providerId } : {}),
        ...(composerContexts.length ? { composerContexts } : {}),
        ...(fileReference ? { fileReferences: [fileReference] } : {}),
        ...(workWhiteboardAdvertisesCanvasTools(whiteboard) ? { guiDesignCanvas: true }
          : workWhiteboardAdvertisesExcalidrawTools(whiteboard) ? { guiExcalidrawCanvas: true } : {}),
        writeContext: {
          workspaceRoot: work.workspaceRoot,
          activeFilePath: work.activeFilePath,
          documentEpoch: document?.documentEpoch ?? 0,
          contentRevision: document?.contentRevision ?? 0,
          ...workWhiteboardMessageFence(whiteboard),
          ...(expectedSha256 ? { expectedSha256 } : {})
        }
      })
      if (sent) {
        const latest = useWriteWorkspaceStore.getState()
        quotedSelections.forEach((selection) => latest.removeQuotedSelection(selection.id))
      }
      return sent
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally { setSending(false) }
  }
  return { sending, error, send }
}
