import { createHash } from 'node:crypto'
import { GmailMailboxSchema, GmailSendInputSchema, type GmailMessage, type GmailMessageSummary, type GmailSendInput } from '../contracts/gmail.js'

type MailPart = {
  mimeType?: string
  filename?: string
  headers?: { name?: string; value?: string }[]
  body?: { data?: string; size?: number }
  parts?: MailPart[]
}
export type GmailWireMessage = { id?: string; threadId?: string; snippet?: string; payload?: MailPart }
const BODY_LIMIT = 32_000

export function summarizeMessage(value: GmailWireMessage): GmailMessageSummary {
  const headers = value.payload?.headers ?? []
  const header = (name: string) => text(headers.find((entry) => entry.name?.toLowerCase() === name)?.value, 1_000)
  return {
    id: validMessageId(value.id),
    ...(value.threadId ? { threadId: validMessageId(value.threadId) } : {}),
    from: header('from'), to: header('to'), subject: header('subject'), date: header('date'),
    snippet: text(value.snippet, 1_000), untrusted: true
  }
}

/** Return bounded plain text; MIME attachments and remote resources are never fetched. */
export function parseMessage(value: GmailWireMessage): GmailMessage {
  const plain: string[] = []
  const html: string[] = []
  let visited = 0
  let truncated = false
  function visit(part: MailPart, depth: number): void {
    if (depth > 8 || visited++ >= 64) { truncated = true; return }
    if (part.filename) return
    if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
      if (typeof part.body?.data === 'string') {
        if (!/^[A-Za-z0-9_-]*={0,2}$/u.test(part.body.data)) return
        // Decode only a bounded prefix, even when the remote response contains a huge body.
        const prefix = part.body.data.slice(0, Math.ceil(BODY_LIMIT * 4 / 3) + 4)
        const decoded = Buffer.from(prefix, 'base64url').toString('utf8')
        if (prefix.length !== part.body.data.length) truncated = true
        ;(part.mimeType === 'text/plain' ? plain : html).push(decoded)
      }
    }
    for (const child of (part.parts ?? []).slice(0, 64)) visit(child, depth + 1)
    if ((part.parts?.length ?? 0) > 64) truncated = true
  }
  if (value.payload) visit(value.payload, 0)
  const combined = plain.length ? plain.join('\n\n') : html.map(htmlToPlain).join('\n\n')
  if (combined.length > BODY_LIMIT) truncated = true
  return { ...summarizeMessage(value), body: text(combined, BODY_LIMIT), truncated }
}

function htmlToPlain(value: string): string {
  return value
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, '')
    .replace(/<!--[^]*?-->/gu, '')
    .replace(/<\s*(?:br|\/p|\/div|\/li|\/tr)\b[^>]*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gu, (entity) =>
      ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ?? '')
    .replace(/&#(x[a-f0-9]+|\d+);/giu, (_, numeric: string) => {
      const code = numeric.toLowerCase().startsWith('x') ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10)
      return code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
    })
}

export function encodeOutgoingMail(value: GmailSendInput, sender: {
  email: string; date: number; operationId: string
}): { raw: string; fingerprint: string } {
  const input = GmailSendInputSchema.parse(value)
  const from = GmailMailboxSchema.parse(sender.email)
  if (!Number.isFinite(sender.date) || !/^[a-f0-9-]{36}$/iu.test(sender.operationId)) throw new Error('Invalid trusted email metadata')
  if (input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) > 20) {
    throw new Error('Gmail supports at most 20 recipients per approved message')
  }
  const encodedSubject = encodeSubject(input.subject)
  const headers = [
    `From: ${from}`,
    `Date: ${new Date(sender.date).toUTCString()}`,
    `Message-ID: <kun.${sender.operationId}@kun-agent.com>`,
    `To: ${input.to.join(',\r\n ')}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(',\r\n ')}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(',\r\n ')}`] : []),
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ]
  const body = Buffer.from(input.body.replace(/\r?\n/gu, '\r\n'), 'utf8').toString('base64')
    .match(/.{1,76}/gu)?.join('\r\n') ?? ''
  return {
    raw: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}\r\n`, 'utf8').toString('base64url'),
    fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex')
  }
}

function encodeSubject(value: string): string {
  if (/^[\x20-\x7e]{0,70}$/u.test(value)) return value
  const words: string[] = []
  let chunk = ''
  for (const character of value) {
    if (Buffer.byteLength(chunk + character) > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`)
      chunk = ''
    }
    chunk += character
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk).toString('base64')}?=`)
  return words.join('\r\n ')
}

function text(value: string | undefined, limit: number): string {
  const characters: string[] = []
  for (const character of typeof value === 'string' ? value : '') {
    const code = character.charCodeAt(0)
    if ((code >= 32 && code !== 127) || code === 9 || code === 10 || code === 13) characters.push(character)
    if (characters.length >= limit) break
  }
  return characters.join('').slice(0, limit)
}
function validMessageId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value)) throw new Error('Gmail returned an invalid message identifier')
  return value
}
