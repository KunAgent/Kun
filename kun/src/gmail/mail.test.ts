import { describe, expect, it } from 'vitest'
import { encodeOutgoingMail, parseMessage } from './mail.js'

describe('Gmail MIME data boundary', () => {
  const sender = { email: 'sender@example.com', date: Date.UTC(2026, 9, 12, 4), operationId: '00000000-0000-4000-8000-000000000001' }
  it('prefers plain text, ignores attachments, and bounds malicious messages', () => {
    const parsed = parseMessage({ id: 'm1', payload: { mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/html', body: { data: Buffer.from('<script>secret()</script><p>HTML</p><img src="https://tracker">').toString('base64url') } },
      { mimeType: 'text/plain', body: { data: Buffer.from('A'.repeat(60_000)).toString('base64url') } },
      { mimeType: 'text/plain', filename: 'attachment.txt', body: { data: Buffer.from('ATTACHMENT').toString('base64url') } }
    ] } })
    expect(parsed.body).toHaveLength(32_000)
    expect(parsed.truncated).toBe(true)
    expect(parsed.body).not.toContain('ATTACHMENT')
    expect(parsed.body).not.toContain('HTML')
    expect(parsed.untrusted).toBe(true)
  })

  it('reduces HTML-only messages to inert text without remote requests', () => {
    const parsed = parseMessage({ id: 'm1', payload: { mimeType: 'text/html', body: {
      data: Buffer.from('<head>head</head><script>run()</script><style>css</style><p>Hello &amp; &#x4e16;&#30028;</p><img src="https://tracker"><a href="javascript:steal()">link</a>').toString('base64url')
    } } })
    expect(parsed.body).toContain('Hello & 世界')
    expect(parsed.body).not.toMatch(/script|tracker|javascript|head|run\(\)|css/u)
    expect(parsed.body).toContain('link')
  })

  it('rejects header injection and produces UTF-8 RFC mail with frozen content', () => {
    const input = { to: ['recipient@example.com'], cc: ['cc@example.com'], bcc: ['bcc@example.com'], subject: 'Kun 演示邮件', body: '你好\nA demo message.' }
    const encoded = encodeOutgoingMail(input, sender)
    const raw = Buffer.from(encoded.raw, 'base64url').toString('utf8')
    expect(raw).toContain('Subject: =?UTF-8?B?')
    expect(raw).toContain('From: sender@example.com')
    expect(raw).toContain('Date: Mon, 12 Oct 2026 04:00:00 GMT')
    expect(raw).toContain('Message-ID: <kun.00000000-0000-4000-8000-000000000001@kun-agent.com>')
    expect(raw).toContain('Bcc: bcc@example.com')
    expect(raw).toContain('Content-Type: text/plain; charset=UTF-8')
    const body = raw.split('\r\n\r\n')[1]
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('你好\r\nA demo message.')
    expect(encoded.fingerprint).toHaveLength(64)
    expect(() => encodeOutgoingMail({ ...input, subject: 'safe\r\nBcc: attacker@example.com' }, sender)).toThrow()
    expect(() => encodeOutgoingMail({ ...input, to: ['recipient@example.com\r\nBcc: attacker@example.com'] }, sender)).toThrow()
    expect(() => encodeOutgoingMail({ ...input, to: Array.from({ length: 20 }, () => 'to@example.com') }, sender)).toThrow()
  })

  it('rejects recipient comments, quoted names and groups instead of silently changing their meaning', () => {
    const input = { to: ['recipient@example.com'], subject: 'Demo', body: 'Demo mail' }
    for (const recipient of ['alice(comment)@example.com', 'Alice <alice@example.com>', '"alice"@example.com', 'alice@[127.0.0.1]', 'Team: alice@example.com;']) {
      expect(() => encodeOutgoingMail({ ...input, to: [recipient] }, sender)).toThrow()
    }
    expect(() => encodeOutgoingMail(input, { ...sender, email: 'alice(comment)@example.com' })).toThrow()
  })
})
