import { useCallback, useRef, useState } from 'react'
import { normalizeScheduleReasoningEffort } from '@shared/app-settings'
import { accountIdForComposerSelection, providerIdForComposerModel } from '../../store/chat-store-helpers'
import type { ScheduledSendDraft } from './ScheduledSendDialog'

type Snapshot = {
  threadId: string
  threadTitle: string
  prompt: string
  workspaceRoot: string
  providerId: string
  accountId: string
  model: string
  reasoningEffort: ReturnType<typeof normalizeScheduleReasoningEffort>
  orchestration: 'direct' | 'graph'
  attachmentIds: string[]
}

type Props = {
  canScheduleSend: boolean
  activeThreadId: string | null
  activeThreadTitle?: string
  input: string
  workspaceRoot: string
  composerProviderId?: string | null
  composerModel: string
  composerModelGroups: Parameters<typeof providerIdForComposerModel>[0]
  composerReasoningEffort: Parameters<typeof normalizeScheduleReasoningEffort>[0]
  orchestration: 'direct' | 'graph'
  attachmentIds: string[]
  setInput: (value: string) => void
  onRemoveAttachment?: (id: string) => void
}

export function useScheduledSend(props: Props) {
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const submittingRef = useRef(false)
  const currentRef = useRef({ threadId: props.activeThreadId, prompt: props.input, attachmentIds: props.attachmentIds })
  currentRef.current = { threadId: props.activeThreadId, prompt: props.input, attachmentIds: props.attachmentIds }
  const openScheduledSend = useCallback(() => {
    if (!props.canScheduleSend || !props.activeThreadId) return
    const providerId = props.composerProviderId?.trim() || providerIdForComposerModel(props.composerModelGroups, props.composerModel)
    setSnapshot({ threadId: props.activeThreadId, threadTitle: props.activeThreadTitle?.trim() || 'Thread', prompt: props.input, workspaceRoot: props.workspaceRoot, providerId, accountId: accountIdForComposerSelection(props.composerModelGroups, providerId, props.composerModel), model: props.composerModel, reasoningEffort: normalizeScheduleReasoningEffort(props.composerReasoningEffort), orchestration: props.orchestration, attachmentIds: [...props.attachmentIds] })
    setError(''); setOpen(true)
  }, [props])
  const submit = useCallback(async ({ atTime, timeZone }: ScheduledSendDraft) => {
    const item = snapshot
    if (!item || submittingRef.current) return
    submittingRef.current = true; setSubmitting(true); setError('')
    try {
      const result = await window.kunGui.createScheduleTask({ title: `Scheduled send: ${item.threadTitle}`.slice(0, 200), prompt: item.prompt, workspaceRoot: item.workspaceRoot, sourceThreadId: item.threadId, providerId: item.providerId, ...(item.accountId ? { accountId: item.accountId } : {}), model: item.model, reasoningEffort: item.reasoningEffort, mode: 'agent', orchestration: item.orchestration, attachmentIds: item.attachmentIds, schedule: { kind: 'at', atTime, timeZone } })
      if (!result.ok) throw new Error(result.message)
      const current = currentRef.current
      const sameAttachments = current.attachmentIds.length === item.attachmentIds.length && current.attachmentIds.every((id, i) => id === item.attachmentIds[i])
      if (current.threadId === item.threadId && current.prompt === item.prompt && sameAttachments) { props.setInput(''); item.attachmentIds.forEach((id) => props.onRemoveAttachment?.(id)) }
      setOpen(false); setSnapshot(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { submittingRef.current = false; setSubmitting(false) }
  }, [snapshot, props])
  return { open, snapshot, submitting, error, openScheduledSend, submit, close: () => { if (!submitting) { setOpen(false); setSnapshot(null) } } }
}
