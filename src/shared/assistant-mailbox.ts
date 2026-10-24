// Contracts for driving third-party personal assistants (Cue, Grok Bot, Muse, dots) through
// Kunserve's end-to-end encrypted assistant mailbox. Secrets and access tokens stay in Main;
// the renderer and the Kun tool bridge only see these projections.

/** Assistants with a tailored preset (logo and install notes). Any other product is a custom kind. */
export const ASSISTANT_PRESET_KINDS = ['cue', 'grok_bot', 'muse', 'dots', 'hark', 'today'] as const
export type AssistantPresetKind = (typeof ASSISTANT_PRESET_KINDS)[number]
/** A preset id, `other`, or a lowercase slug derived from a custom product name. */
export type AssistantKind = string
export type AssistantPromptLocale = 'zh' | 'en'

/** `queued` until accepted by the server, then `sent` until acknowledged; `cancelled` stays. */
export type AssistantTaskStatus = 'queued' | 'sent' | 'received' | 'working' | 'done' | 'blocked' | 'failed' | 'cancelled'

/** `unavailable` means the server has not enabled the mailbox (it answers 404). */
export type AssistantMailboxAvailability = 'unknown' | 'available' | 'unavailable' | 'login_required' | 'disabled' | 'upgrade_required'

export type AssistantView = {
  id: string
  enrollmentId: string
  name: string
  kind: AssistantKind
  /** Product name the user typed for a custom assistant. */
  product?: string
  /** Icon fetched from a custom assistant's website, as a data URL. */
  icon?: string
  platform: string
  agentVersion: string
  reportedVersion?: string
  reportedAt?: string
  updateError?: string
  createdAt: string
  lastSeenAt: string | null
  pendingToAssistant: number
  pendingToHost: number
  /** False when this desktop no longer holds the enrollment key (another computer enrolled it). */
  keyAvailable: boolean
}

/** An assistant asking to join; the user approves it after comparing verification codes. */
export type AssistantJoinRequestView = {
  requestId: string
  platform: string
  agentVersion: string
  createdAt: string
  /** What the assistant must also show; null when another computer created this enrollment. */
  verificationCode: string | null
}

export type AssistantEnrollmentView = {
  enrollmentId: string
  name: string
  kind: AssistantKind
  product?: string
  icon?: string
  expiresAt: string
  requests: AssistantJoinRequestView[]
}

export type AssistantTaskUpdate = {
  status: Exclude<AssistantTaskStatus, 'queued' | 'sent' | 'cancelled'>
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
  /** `you`: a reply the user sent from Kun; `assistant`: a message the assistant sent. */
  from: 'assistant' | 'you'
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

export type AssistantEnrollmentRequest = {
  name: string
  kind: AssistantKind
  locale: AssistantPromptLocale
  /** Custom assistants: the product's name and website (its icon is fetched from there). */
  product?: string
  website?: string
}
export type AssistantEnrollmentResult = { enrollmentId: string; code: string; expiresAt: string; prompt: string }
export type AssistantAssignRequest = { assistantId: string; title?: string; body: string; deadline?: string }

export type AssistantMailboxApi = {
  status(): Promise<AssistantMailboxStatus>
  refresh(): Promise<AssistantMailboxStatus>
  updatePrompt(assistantId: string, locale: AssistantPromptLocale): Promise<{ version: string; releaseId: string; prompt: string }>
  createEnrollment(request: AssistantEnrollmentRequest): Promise<AssistantEnrollmentResult>
  approve(enrollmentId: string, requestId: string, verificationCode: string): Promise<AssistantMailboxStatus>
  reject(enrollmentId: string, requestId: string): Promise<AssistantMailboxStatus>
  cancelEnrollment(enrollmentId: string): Promise<AssistantMailboxStatus>
  revoke(assistantId: string): Promise<AssistantMailboxStatus>
  assign(request: AssistantAssignRequest): Promise<AssistantTaskView>
  cancel(taskId: string): Promise<AssistantTaskView>
  /** Answers a task the assistant marked blocked; delivered as a note about that task. */
  reply(taskId: string, body: string): Promise<AssistantMailboxStatus>
  /** The install prompt of a pending enrollment, rebuilt from this computer's key. */
  promptFor(enrollmentId: string, locale: AssistantPromptLocale): Promise<{ code: string; prompt: string } | null>
  onStatus(listener: (status: AssistantMailboxStatus) => void): () => void
}

export const ASSISTANT_MAILBOX_CHANNELS = {
  status: 'assistant-mailbox:status',
  refresh: 'assistant-mailbox:refresh',
  updatePrompt: 'assistant-mailbox:update-prompt',
  enroll: 'assistant-mailbox:enroll',
  approve: 'assistant-mailbox:approve',
  reject: 'assistant-mailbox:reject',
  cancelEnrollment: 'assistant-mailbox:cancel-enrollment',
  revoke: 'assistant-mailbox:revoke',
  assign: 'assistant-mailbox:assign',
  cancel: 'assistant-mailbox:cancel',
  reply: 'assistant-mailbox:reply',
  promptFor: 'assistant-mailbox:prompt-for',
  changed: 'assistant-mailbox:changed'
} as const

export const ASSISTANT_TITLE_MAX = 200
export const ASSISTANT_BODY_MAX_BYTES = 32 * 1024
export const ASSISTANT_NAME_MAX = 80

export function isAssistantKind(value: unknown): value is AssistantKind {
  return typeof value === 'string' && /^[a-z0-9_]{1,32}$/.test(value)
}

export function isAssistantPresetKind(value: unknown): value is AssistantPresetKind {
  return typeof value === 'string' && (ASSISTANT_PRESET_KINDS as readonly string[]).includes(value)
}

/** Server kind for a custom product: its ASCII letters and digits as a slug, else `other`. */
export function customAssistantKind(product: string): AssistantKind {
  const slug = product.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32)
  return slug && !isAssistantPresetKind(slug) ? slug : 'other'
}
