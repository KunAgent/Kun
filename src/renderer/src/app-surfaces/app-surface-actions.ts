import i18n from '../i18n'
import { confirmDialog } from '../lib/confirm-dialog'
import { useChatStore } from '../store/chat-store'
import { appSandboxApi } from './app-sandbox-client'

const MAX_PROMPT_CHARS = 8_000

function boundedPreview(text: string): string {
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

/**
 * A page asked to send a follow-up message. A native click inside the page
 * within the gesture window sends directly; otherwise the user confirms the
 * exact text. Only the thread that owns the card can receive the message.
 */
export async function sendAppFollowUp(input: {
  instanceId: string
  threadId: string
  prompt: string
  title?: string
  appLabel: string
}): Promise<boolean> {
  const prompt = input.prompt.trim().slice(0, MAX_PROMPT_CHARS)
  if (!prompt) return false
  const state = useChatStore.getState()
  if (state.activeThreadId !== input.threadId || state.route !== 'chat') return false
  const gesture = (await appSandboxApi()?.consumeGesture(input.instanceId)) === true
  if (!gesture) {
    const confirmed = await confirmDialog(
      i18n.t('common:appSurfaceFollowUpConfirm', { app: input.title?.trim() || input.appLabel }),
      boundedPreview(prompt)
    )
    if (!confirmed) return false
  }
  if (useChatStore.getState().activeThreadId !== input.threadId) return false
  return useChatStore.getState().sendMessage(prompt, 'agent', { expectedThreadId: input.threadId })
}

export async function openAppLink(input: { instanceId: string; url: string; appLabel: string }): Promise<boolean> {
  let url: URL
  try {
    url = new URL(input.url)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const api = appSandboxApi()
  if (!api) return false
  const gesture = await api.consumeGesture(input.instanceId)
  if (!gesture) {
    const confirmed = await confirmDialog(
      i18n.t('common:appSurfaceOpenLinkConfirm', { app: input.appLabel }),
      url.toString()
    )
    if (!confirmed) return false
  }
  return api.openExternal(input.instanceId, url.toString())
}

type DownloadContent = { type?: unknown; resource?: unknown }

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

/**
 * Save the first embedded resource a page offers for download. Only inline
 * bytes are accepted (no host fetching of links); the native save dialog lets
 * the user choose the destination.
 */
export async function saveAppDownload(instanceId: string, appLabel: string, contents: readonly unknown[]): Promise<boolean> {
  const embedded = contents.find((entry): entry is DownloadContent =>
    Boolean(entry) && typeof entry === 'object' && (entry as DownloadContent).type === 'resource')
  const resource = embedded?.resource as { uri?: unknown; mimeType?: unknown; blob?: unknown; text?: unknown } | undefined
  if (!resource) return false
  const base64 = typeof resource.blob === 'string'
    ? resource.blob
    : typeof resource.text === 'string' ? utf8ToBase64(resource.text) : null
  if (!base64) return false
  const uri = typeof resource.uri === 'string' ? resource.uri : ''
  const name = decodeURIComponent(uri.split('/').pop() || 'download')
  const api = appSandboxApi()
  if (!api) return false
  if (!(await api.consumeGesture(instanceId))) {
    const confirmed = await confirmDialog(i18n.t('common:appSurfaceDownloadConfirm', { app: appLabel }), name)
    if (!confirmed) return false
  }
  return api.saveFile(instanceId, {
    name,
    mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : 'application/octet-stream',
    base64
  })
}
