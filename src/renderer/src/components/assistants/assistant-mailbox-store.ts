// Renderer-wide assistant mailbox state. Main owns the data and pushes a snapshot after every
// sync; the sidebar and the conversation stage read the same store and share its actions.
import { create } from 'zustand'
import i18n from '../../i18n'
import type {
  AssistantAssignRequest, AssistantEnrollmentRequest, AssistantEnrollmentResult, AssistantMailboxStatus,
  AssistantPromptLocale, AssistantTaskView
} from '@shared/assistant-mailbox'

type MailboxState = { status: AssistantMailboxStatus | null; busy: boolean; error: string }

export const useAssistantMailboxStore = create<MailboxState>(() => ({ status: null, busy: false, error: '' }))

const api = () => (typeof window === 'undefined' ? undefined : window.kunGui?.assistantMailbox)

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('vip_personal_assistant_required')) return i18n.t('assistantVipRequired', { ns: 'common' })
  if (text.includes('updates_not_configured')) return i18n.t('assistantUpdatesNotConfigured', { ns: 'common' })
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

let started = false
let timer: ReturnType<typeof setInterval> | undefined

/** Starts listening once. While an enrollment waits, asks Main every 5 s so requests show up quickly. */
export function startAssistantMailbox(): void {
  const mailbox = api()
  if (started || !mailbox) return
  started = true
  const set = (status: AssistantMailboxStatus) => useAssistantMailboxStore.setState({ status })
  void mailbox.status().then(set).catch((error: unknown) => useAssistantMailboxStore.setState({ error: message(error) }))
  mailbox.onStatus(set)
  timer = setInterval(() => {
    const status = useAssistantMailboxStore.getState().status
    if (status?.enrollments.length && document.visibilityState === 'visible') void mailbox.status().then(set).catch(() => {})
  }, 5000)
}

/** Test seam: forget the subscription. */
export function resetAssistantMailboxForTests(): void {
  started = false
  if (timer) clearInterval(timer)
  useAssistantMailboxStore.setState({ status: null, busy: false, error: '' })
}

async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
  useAssistantMailboxStore.setState({ busy: true, error: '' })
  try {
    return await work()
  } catch (error) {
    useAssistantMailboxStore.setState({ error: message(error) })
    return undefined
  } finally {
    useAssistantMailboxStore.setState({ busy: false })
  }
}

const withStatus = (work: () => Promise<AssistantMailboxStatus> | undefined) => run(async () => {
  const status = await work()
  if (status) useAssistantMailboxStore.setState({ status })
  return status
})

export const assistantMailbox = {
  clearError: () => useAssistantMailboxStore.setState({ error: '' }),
  refresh: () => withStatus(() => api()?.refresh()),
  updatePrompt: (id: string, locale: AssistantPromptLocale) => run(async () => api()!.updatePrompt(id, locale)),
  createEnrollment: (request: AssistantEnrollmentRequest): Promise<AssistantEnrollmentResult | undefined> =>
    run(async () => api()!.createEnrollment(request)),
  promptFor: (enrollmentId: string, locale: AssistantPromptLocale) => run(async () => api()!.promptFor(enrollmentId, locale)),
  approve: (enrollmentId: string, requestId: string, verificationCode: string) => withStatus(() => api()?.approve(enrollmentId, requestId, verificationCode)),
  reject: (enrollmentId: string, requestId: string) => withStatus(() => api()?.reject(enrollmentId, requestId)),
  cancelEnrollment: (enrollmentId: string) => withStatus(() => api()?.cancelEnrollment(enrollmentId)),
  revoke: (assistantId: string) => withStatus(() => api()?.revoke(assistantId)),
  assign: (request: AssistantAssignRequest): Promise<AssistantTaskView | undefined> => run(async () => api()!.assign(request)),
  cancelTask: (taskId: string) => run(async () => api()!.cancel(taskId)),
  reply: (taskId: string, body: string) => withStatus(() => api()?.reply(taskId, body))
}
