import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { readWriteDocumentSha256 } from '../../components/workbench/read-write-document-sha256'
import { workbenchWriteSourceReference } from '../../components/workbench/workbench-write-source-reference'
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
    if (!prompt || sending || chat.runtimeConnection !== 'ready') return false
    const work = useWriteWorkspaceStore.getState()
    const document = work.activeFilePath ? work.documentsByPath[work.activeFilePath] : null
    const whiteboard = work.activeWhiteboardId ? work.whiteboards[work.activeWhiteboardId] ?? null : null
    if (!work.workspaceRoot || (!document && !whiteboard)) return false
    if (document && !['text', 'code'].includes(document.kind)) {
      setError('This resource needs its full semantic assistant context before it can be sent on mobile.')
      return false
    }
    setSending(true)
    setError('')
    try {
      if (document && !await work.saveAllDocuments(work.workspaceRoot)) {
        setError('Save the document before sending it to the assistant.')
        return false
      }
      let threadId = whiteboard?.threadId ?? null
      if (whiteboard && !threadId) {
        threadId = await chat.createThread(work.workspaceRoot, undefined, {
          title: whiteboard.title,
          titleAuto: false
        })
        if (threadId && !await work.bindWhiteboardThread(whiteboard.id, threadId)) {
          setError('The whiteboard conversation could not be bound.')
          return false
        }
      }
      threadId ??= await chat.ensureThread(work.workspaceRoot, work.activeFilePath ?? undefined)
      if (!threadId) return false
      if (chat.activeThreadId !== threadId) {
        await chat.selectThread(threadId, work.workspaceRoot, work.activeFilePath ?? undefined)
      }
      const composerContexts = whiteboard
        ? await activeWorkWhiteboardComposerContexts(work.workspaceRoot, whiteboard, threadId, prompt)
        : []
      if (whiteboard && !workWhiteboardSnapshotMatches(useWriteWorkspaceStore.getState(), {
        ...whiteboard, threadId
      })) {
        setError('The active whiteboard changed before the message was sent.')
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
      return await chat.sendMessage(prompt, 'agent', {
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    } finally { setSending(false) }
  }
  return { sending, error, send }
}
