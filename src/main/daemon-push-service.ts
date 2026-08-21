import type { AppSettingsV1, SessionDaemonV1 } from '../shared/app-settings'
import type { WeixinOutboundSend } from './weixin-bridge-outbound-coordinator'
import type { JsonSettingsStore } from './settings-store'

export type WeixinBridgeSendFn = (options: WeixinOutboundSend) => Promise<{ ok: true; messageId: string } | { ok: false; message: string }>

export type DaemonPushServiceDeps = {
  store: JsonSettingsStore
  logError: (category: string, message: string, detail?: unknown) => void
  sendWeixinBridgeMessage?: WeixinBridgeSendFn
}

/**
 * Delivers a daemon `[kun-push]` frame to the WeChat conversation that was
 * explicitly bound in the daemon config. The frame payload can never select
 * the recipient — only `daemon.push.channelId + conversationId` decide it.
 * Returns `{ ok: false }` with a human-readable reason for every failure.
 */
export async function pushDaemonTextToWeixin(
  deps: DaemonPushServiceDeps,
  settings: AppSettingsV1,
  daemon: SessionDaemonV1,
  text: string
): Promise<{ ok: boolean; message?: string }> {
  if (!daemon.push.enabled) {
    return { ok: false, message: 'Daemon push is not enabled.' }
  }
  if (!daemon.push.channelId.trim() || !daemon.push.conversationId.trim()) {
    return { ok: false, message: 'Push target is not configured.' }
  }
  const channel = settings.claw.channels.find(
    (candidate) =>
      candidate.id === daemon.push.channelId &&
      candidate.enabled &&
      candidate.provider === 'weixin'
  )
  if (!channel) {
    return { ok: false, message: 'WeChat channel is missing or disabled.' }
  }
  const conversation = channel.conversations.find(
    (candidate) => candidate.id === daemon.push.conversationId
  )
  if (!conversation) {
    return { ok: false, message: 'Push conversation is missing.' }
  }
  const chatId = conversation.chatId.trim()
  if (!chatId) {
    return { ok: false, message: 'Push conversation has no chat id.' }
  }
  const credential = channel.platformCredential
  if (credential?.kind !== 'weixin' || !credential.accountId.trim()) {
    return { ok: false, message: 'WeChat account is not configured for this channel.' }
  }
  if (!deps.sendWeixinBridgeMessage) {
    return { ok: false, message: 'WeChat bridge is not available.' }
  }
  try {
    const result = await deps.sendWeixinBridgeMessage({
      accountId: credential.accountId,
      to: chatId,
      text
    })
    if (!result.ok) {
      deps.logError('daemon-push', 'Daemon push to WeChat failed.', {
        daemonId: daemon.id,
        message: result.message
      })
      return { ok: false, message: result.message }
    }
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.logError('daemon-push', 'Daemon push to WeChat threw.', {
      daemonId: daemon.id,
      message
    })
    return { ok: false, message }
  }
}

/** Bind the push service to a daemon runtime inside the main process. */
export function createDaemonPushText(
  deps: DaemonPushServiceDeps
): (input: { daemon: SessionDaemonV1; text: string }) => Promise<{ ok: boolean; message?: string }> {
  return async ({ daemon, text }) => {
    const settings = await deps.store.load()
    return pushDaemonTextToWeixin(deps, settings, daemon, text)
  }
}
