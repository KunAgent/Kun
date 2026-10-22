// Contracts for driving third-party personal assistants (Cue, Grok Bot, Muse, dots) through
// Kunserve's end-to-end encrypted assistant mailbox. Secrets and access tokens stay in Main;
// the renderer and the Kun tool bridge only see these projections.

export const ASSISTANT_KINDS = ['cue', 'grok_bot', 'muse', 'dots', 'other'] as const
export type AssistantKind = (typeof ASSISTANT_KINDS)[number]
export type AssistantPromptLocale = 'zh' | 'en'

/** `sent` until the assistant acknowledges; `cancelled` is set by Kun and stays. */
export type AssistantTaskStatus = 'sent' | 'received' | 'working' | 'done' | 'blocked' | 'failed' | 'cancelled'

/** `unavailable` means the server has not enabled the mailbox (it answers 404). */
export type AssistantMailboxAvailability = 'unknown' | 'available' | 'unavailable' | 'login_required' | 'disabled'

export type AssistantView = {
  id: string
  name: string
  kind: AssistantKind
  platform: string
  agentVersion: string
  createdAt: string
  lastSeenAt: string | null
  pendingToAssistant: number
  pendingToHost: number
  /** False when this desktop no longer holds the enrollment key (another computer enrolled it). */
  keyAvailable: boolean
}

export type AssistantEnrollmentView = {
  enrollmentId: string
  name: string
  kind: AssistantKind
  expiresAt: string
}

export type AssistantTaskUpdate = {
  status: Exclude<AssistantTaskStatus, 'sent' | 'cancelled'>
  body: string
  at: string
}

export type AssistantTaskView = {
  id: string
  assistantId: string
  assistantName: string
  title: string
  body: string
  deadline?: string
  createdAt: string
  updatedAt: string
  status: AssistantTaskStatus
  updates: AssistantTaskUpdate[]
}

export type AssistantNoteView = {
  id: string
  assistantId: string
  assistantName: string
  title?: string
  body: string
  at: string
  inReplyTo?: string
}

export type AssistantMailboxStatus = {
  availability: AssistantMailboxAvailability
  assistants: AssistantView[]
  enrollments: AssistantEnrollmentView[]
  /** Most recent first. */
  tasks: AssistantTaskView[]
  /** Most recent first. */
  notes: AssistantNoteView[]
  lastSyncAt?: string
  error?: string
}

export type AssistantEnrollmentRequest = { name: string; kind: AssistantKind; locale: AssistantPromptLocale }
export type AssistantEnrollmentResult = { enrollmentId: string; code: string; expiresAt: string; prompt: string }
export type AssistantAssignRequest = { assistantId: string; title?: string; body: string; deadline?: string }

export type AssistantMailboxApi = {
  status(): Promise<AssistantMailboxStatus>
  refresh(): Promise<AssistantMailboxStatus>
  createEnrollment(request: AssistantEnrollmentRequest): Promise<AssistantEnrollmentResult>
  revoke(assistantId: string): Promise<AssistantMailboxStatus>
  assign(request: AssistantAssignRequest): Promise<AssistantTaskView>
  cancel(taskId: string): Promise<AssistantTaskView>
  onStatus(listener: (status: AssistantMailboxStatus) => void): () => void
}

export const ASSISTANT_MAILBOX_CHANNELS = {
  status: 'assistant-mailbox:status',
  refresh: 'assistant-mailbox:refresh',
  enroll: 'assistant-mailbox:enroll',
  revoke: 'assistant-mailbox:revoke',
  assign: 'assistant-mailbox:assign',
  cancel: 'assistant-mailbox:cancel',
  changed: 'assistant-mailbox:changed'
} as const

export const ASSISTANT_TITLE_MAX = 200
export const ASSISTANT_BODY_MAX_BYTES = 32 * 1024
export const ASSISTANT_NAME_MAX = 80

export function isAssistantKind(value: unknown): value is AssistantKind {
  return typeof value === 'string' && (ASSISTANT_KINDS as readonly string[]).includes(value)
}
