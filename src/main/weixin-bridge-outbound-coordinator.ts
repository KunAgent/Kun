import { createHash } from 'node:crypto'
import type { WeixinLocalSendResponse } from '../shared/weixin-local-send'
import { logError } from './logger'
import {
  getContextToken,
  restoreContextTokens,
  sendGeneratedFilesWeixin,
  sendMessageWeixin,
  type WeixinOutboundFile
} from './weixin-bridge-channel'
import { normalizeAccountId, resolveWeixinAccount } from './weixin-bridge-storage'
import type { WeixinBridgeSendResult } from './weixin-bridge-state'

export type WeixinOutboundSend = {
  accountId: string
  to: string
  text?: string
  files?: readonly WeixinOutboundFile[]
  idempotencyKey?: string
}

type CachedSend = { fingerprint: string; promise: Promise<WeixinBridgeSendResult> }
const conversationTails = new Map<string, Promise<void>>()
const restoredAccounts = new Map<string, Promise<void>>()
const idempotentSends = new Map<string, CachedSend>()

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = conversationTails.get(key) ?? Promise.resolve()
  const result = previous.then(task, task)
  const tail = result.then(() => undefined, () => undefined)
  conversationTails.set(key, tail)
  void tail.finally(() => {
    if (conversationTails.get(key) === tail) conversationTails.delete(key)
  })
  return result
}

function restoreAccountOnce(accountId: string): Promise<void> {
  let pending = restoredAccounts.get(accountId)
  if (!pending) {
    pending = restoreContextTokens(accountId).catch((error) => {
      restoredAccounts.delete(accountId)
      throw error
    })
    restoredAccounts.set(accountId, pending)
  }
  return pending
}

function fingerprint(input: WeixinOutboundSend): string {
  return createHash('sha256').update(JSON.stringify({
    accountId: input.accountId,
    to: input.to,
    text: input.text ?? '',
    files: input.files ?? []
  })).digest('hex')
}

async function sendQueued(input: WeixinOutboundSend): Promise<WeixinBridgeSendResult> {
  const accountId = normalizeAccountId(input.accountId)
  const to = input.to.trim()
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  if (!accountId) return { ok: false, message: 'WeChat account id is missing.' }
  if (!to) return { ok: false, message: 'WeChat recipient is missing.' }
  if (!text && files.length === 0) return { ok: false, message: 'Message is empty.' }

  return enqueue(`${accountId}:${to}`, async () => {
    try {
      const account = await resolveWeixinAccount(accountId)
      if (!account.configured || !account.token?.trim()) {
        return { ok: false, message: 'WeChat account is not configured.' }
      }
      await restoreAccountOnce(account.accountId)
      // Read only after this conversation reaches the head of the outbound
      // queue, so a token rolled by inbound polling while waiting is observed.
      const contextToken = getContextToken(account.accountId, to)
      let messageId = ''
      if (text) {
        messageId = (await sendMessageWeixin({ account, to, text, contextToken })).messageId
      }
      if (files.length > 0) await sendGeneratedFilesWeixin(account, to, files, contextToken)
      return { ok: true, messageId }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logError('weixin-bridge', 'Failed to send WeChat message from GUI.', { message, accountId, to })
      return { ok: false, message }
    }
  })
}

export function coordinateWeixinOutbound(input: WeixinOutboundSend): Promise<WeixinBridgeSendResult> {
  const key = input.idempotencyKey?.trim()
  if (!key) return sendQueued(input)
  const digest = fingerprint(input)
  const existing = idempotentSends.get(key)
  if (existing) {
    if (existing.fingerprint !== digest) {
      return Promise.resolve({ ok: false, message: 'Idempotency key was already used for a different request.' })
    }
    return existing.promise
  }
  const promise = sendQueued(input)
  idempotentSends.set(key, { fingerprint: digest, promise })
  return promise
}

export function localSendResponse(
  result: WeixinBridgeSendResult,
  idempotencyKey: string
): WeixinLocalSendResponse {
  return result.ok
    ? { status: 'accepted', messageId: result.messageId, idempotencyKey }
    : {
        status: 'rejected',
        error: {
          code: result.message.startsWith('Idempotency key') ? 'idempotency_conflict' : 'send_failed',
          message: result.message
        },
        idempotencyKey
      }
}

export function resetWeixinOutboundCoordinator(): void {
  conversationTails.clear()
  restoredAccounts.clear()
  idempotentSends.clear()
}
