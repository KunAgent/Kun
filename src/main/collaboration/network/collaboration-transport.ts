import { createHash, X509Certificate } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import type { TLSSocket } from 'node:tls'
import { InvitationBundleSchema, type InvitationBundle } from '@kun/collaboration-protocol'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

const PinSchema = z.object({
  serverUrl: z.url(),
  serverInstanceId: z.string().min(1),
  spkiSha256: z.string().length(64).regex(/^[a-f0-9]+$/i),
  trustedAt: z.iso.datetime()
}).strict()
const PinFileSchema = z.object({ version: z.literal(1), pins: z.array(PinSchema) }).strict()
export type ServerIdentity = Pick<z.infer<typeof PinSchema>, 'serverUrl' | 'serverInstanceId' | 'spkiSha256'>

export class CollaborationTransportError extends Error {
  constructor(
    readonly code:
      | 'server_identity_changed'
      | 'server_tls_required'
      | 'server_tls_version_invalid'
      | 'server_certificate_invalid'
      | 'server_protocol_invalid'
      | 'server_request_failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'CollaborationTransportError'
  }
}

const HealthSchema = z.object({
  ok: z.literal(true),
  protocol: z.literal(1),
  serverInstanceId: z.string().min(1),
  receiptVerifyingKey: z.string().min(1)
}).strict()

const DeviceCredentialSchema = z.object({
  memberId: z.string().min(1),
  deviceId: z.string().min(1),
  accessToken: z.string().min(32)
}).strict()
export type CollaborationDeviceCredential = z.infer<typeof DeviceCredentialSchema>

const ServerInvitationSchema = z.object({
  invitationId: z.string().min(1),
  meetingId: z.string().min(1),
  role: z.string().min(1),
  oneTimeCredential: z.string().min(1),
  expiresAt: z.number().int().positive()
}).strict()

const PendingJoinRequestSchema = z.object({
  invitationId: z.string().min(1),
  meetingId: z.string().min(1),
  memberId: z.string().min(1),
  deviceId: z.string().min(1),
  displayName: z.string().min(1),
  role: z.string().min(1),
  keyPackage: z.string().min(1)
}).strict()
export type PendingJoinRequest = z.infer<typeof PendingJoinRequestSchema>

const AdmissionSchema = z.object({
  status: z.enum(['pending', 'ready']),
  meetingId: z.string().min(1),
  welcome: z.string().nullable().optional(),
  ratchetTree: z.string().nullable().optional(),
  throughSequence: z.number().int().nonnegative()
}).strict()
export type CollaborationAdmission = z.infer<typeof AdmissionSchema>

export type CollaborationRequest = {
  serverUrl: string
  path: string
  method: 'GET' | 'POST'
  bearer?: string
  body?: unknown
  expectedSpkiSha256?: string
}

type ConnectedServer = ServerIdentity & { receiptVerifyingKey: string }

export class CollaborationHttpClient {
  constructor(private readonly options: {
    pins: ServerPinStore
    inspect?: typeof inspectTls13Server
    request?: (request: CollaborationRequest) => Promise<unknown>
  }) {}

  async connect(serverUrl: string, expected?: Omit<ServerIdentity, 'serverUrl'>): Promise<ConnectedServer> {
    const normalizedUrl = normalizeServerUrl(serverUrl)
    const inspection = await (this.options.inspect ?? inspectTls13Server)(normalizedUrl)
    if (expected && inspection.spkiSha256.toLowerCase() !== expected.spkiSha256.toLowerCase()) {
      throw new CollaborationTransportError('server_identity_changed', 'Collaboration server certificate does not match the invitation')
    }
    const health = HealthSchema.parse(await this.request({
      serverUrl: normalizedUrl,
      path: '/health',
      method: 'GET',
      expectedSpkiSha256: inspection.spkiSha256
    }))
    if (expected && health.serverInstanceId !== expected.serverInstanceId) {
      throw new CollaborationTransportError('server_identity_changed', 'Collaboration server instance does not match the invitation')
    }
    const identity = {
      serverUrl: normalizedUrl,
      serverInstanceId: health.serverInstanceId,
      spkiSha256: inspection.spkiSha256
    }
    await this.options.pins.verify(identity)
    return { ...identity, receiptVerifyingKey: health.receiptVerifyingKey }
  }

  async enrollOperator(input: {
    serverUrl: string
    enrollmentToken: string
    memberId: string
    deviceId: string
    displayName: string
  }): Promise<CollaborationDeviceCredential> {
    const server = await this.connect(input.serverUrl)
    return DeviceCredentialSchema.parse(await this.request({
      serverUrl: server.serverUrl,
      path: '/v1/operator/enroll',
      method: 'POST',
      bearer: input.enrollmentToken,
      body: { memberId: input.memberId, deviceId: input.deviceId, displayName: input.displayName },
      expectedSpkiSha256: server.spkiSha256
    }))
  }

  async createMeeting(input: { serverUrl: string; accessToken: string; meetingId: string }): Promise<void> {
    const server = await this.connect(input.serverUrl)
    await this.request({
      serverUrl: server.serverUrl,
      path: '/v1/meetings',
      method: 'POST',
      bearer: input.accessToken,
      body: { meetingId: input.meetingId },
      expectedSpkiSha256: server.spkiSha256
    })
  }

  async createInvitation(input: {
    serverUrl: string
    accessToken: string
    meetingId: string
    role: string
    expiresInSeconds: number
  }): Promise<InvitationBundle> {
    const server = await this.connect(input.serverUrl)
    const invitation = ServerInvitationSchema.parse(await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/invitations`,
      method: 'POST',
      bearer: input.accessToken,
      body: { role: input.role, expiresInSeconds: input.expiresInSeconds },
      expectedSpkiSha256: server.spkiSha256
    }))
    return InvitationBundleSchema.parse({
      version: 1,
      invitationId: invitation.invitationId,
      serverUrl: server.serverUrl,
      serverInstanceId: server.serverInstanceId,
      spkiSha256: server.spkiSha256,
      meetingId: invitation.meetingId,
      oneTimeCredential: invitation.oneTimeCredential,
      expiresAt: new Date(invitation.expiresAt * 1000).toISOString()
    })
  }

  async consumeInvitation(input: {
    invitation: InvitationBundle
    memberId: string
    deviceId: string
    displayName: string
    keyPackage: string
  }): Promise<CollaborationDeviceCredential> {
    const invitation = InvitationBundleSchema.parse(input.invitation)
    const server = await this.connect(invitation.serverUrl, invitation)
    return DeviceCredentialSchema.parse(await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/invitations/${encodeURIComponent(invitation.invitationId)}/consume`,
      method: 'POST',
      bearer: invitation.oneTimeCredential,
      body: {
        memberId: input.memberId,
        deviceId: input.deviceId,
        displayName: input.displayName,
        keyPackage: input.keyPackage
      },
      expectedSpkiSha256: server.spkiSha256
    }))
  }

  async listJoinRequests(input: {
    serverUrl: string
    accessToken: string
    meetingId: string
  }): Promise<PendingJoinRequest[]> {
    const server = await this.connect(input.serverUrl)
    const response = z.object({ requests: z.array(PendingJoinRequestSchema) }).strict().parse(await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/join-requests`,
      method: 'GET',
      bearer: input.accessToken,
      expectedSpkiSha256: server.spkiSha256
    }))
    return response.requests
  }

  async admitJoinRequest(input: {
    serverUrl: string
    accessToken: string
    meetingId: string
    invitationId: string
    welcome: string
    ratchetTree: string
    throughSequence: number
  }): Promise<void> {
    const server = await this.connect(input.serverUrl)
    await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/join-requests/${encodeURIComponent(input.invitationId)}/admit`,
      method: 'POST',
      bearer: input.accessToken,
      body: {
        welcome: input.welcome,
        ratchetTree: input.ratchetTree,
        throughSequence: input.throughSequence
      },
      expectedSpkiSha256: server.spkiSha256
    })
  }

  async removeMember(input: {
    serverUrl: string
    accessToken: string
    meetingId: string
    memberId: string
  }): Promise<void> {
    const server = await this.connect(input.serverUrl)
    await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/members/${encodeURIComponent(input.memberId)}/remove`,
      method: 'POST',
      bearer: input.accessToken,
      expectedSpkiSha256: server.spkiSha256
    })
  }

  async getAdmission(input: {
    serverUrl: string
    accessToken: string
    invitationId: string
  }): Promise<CollaborationAdmission> {
    const server = await this.connect(input.serverUrl)
    return AdmissionSchema.parse(await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/admissions/${encodeURIComponent(input.invitationId)}`,
      method: 'GET',
      bearer: input.accessToken,
      expectedSpkiSha256: server.spkiSha256
    }))
  }

  async listEvents(input: { serverUrl: string; accessToken: string; meetingId: string; after: number }): Promise<unknown[]> {
    const server = await this.connect(input.serverUrl)
    const response = z.object({ events: z.array(z.unknown()) }).parse(await this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/events?after=${input.after}`,
      method: 'GET',
      bearer: input.accessToken,
      expectedSpkiSha256: server.spkiSha256
    }))
    return response.events
  }

  async submitCommand(input: {
    serverUrl: string
    accessToken: string
    meetingId: string
    command: unknown
  }): Promise<unknown> {
    const server = await this.connect(input.serverUrl)
    return this.request({
      serverUrl: server.serverUrl,
      path: `/v1/meetings/${encodeURIComponent(input.meetingId)}/commands`,
      method: 'POST',
      bearer: input.accessToken,
      body: input.command,
      expectedSpkiSha256: server.spkiSha256
    })
  }

  private request(request: CollaborationRequest): Promise<unknown> {
    return (this.options.request ?? requestPinnedJson)(request)
  }
}

export class ServerPinStore {
  constructor(private readonly path: string) {}

  async verify(identity: ServerIdentity): Promise<{ trusted: true; firstUse: boolean }> {
    const normalized = normalizeIdentity(identity)
    const state = await this.load()
    const existing = state.pins.find((pin) => pin.serverUrl === normalized.serverUrl)
    if (existing) {
      if (
        existing.serverInstanceId !== normalized.serverInstanceId ||
        existing.spkiSha256.toLowerCase() !== normalized.spkiSha256.toLowerCase()
      ) {
        throw new CollaborationTransportError(
          'server_identity_changed',
          `Collaboration server identity changed for ${normalized.serverUrl}`
        )
      }
      return { trusted: true, firstUse: false }
    }
    state.pins.push({ ...normalized, trustedAt: new Date().toISOString() })
    await writePrivateFileAtomic(this.path, `${JSON.stringify(state, null, 2)}\n`)
    return { trusted: true, firstUse: true }
  }

  private async load(): Promise<z.infer<typeof PinFileSchema>> {
    const content = await readFile(this.path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    return content === null ? { version: 1, pins: [] } : PinFileSchema.parse(JSON.parse(content))
  }
}

export async function inspectTls13Server(serverUrl: string): Promise<{ spkiSha256: string }> {
  const url = new URL(serverUrl)
  if (url.protocol !== 'https:') {
    throw new CollaborationTransportError('server_tls_required', 'Collaboration server must use HTTPS')
  }
  const certificate = await new Promise<Buffer>((resolve, reject) => {
    const socket = tlsConnect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3'
    }, () => {
      if (socket.getProtocol() !== 'TLSv1.3') {
        socket.destroy()
        reject(new CollaborationTransportError('server_tls_version_invalid', 'Collaboration server did not negotiate TLS 1.3'))
        return
      }
      const peer = socket.getPeerCertificate(true)
      const raw = peer.raw ? Buffer.from(peer.raw) : null
      socket.end()
      if (!raw) reject(new CollaborationTransportError('server_certificate_invalid', 'Collaboration server certificate is missing'))
      else resolve(raw)
    })
    socket.once('error', reject)
  })
  try {
    return { spkiSha256: spkiDigest(certificate) }
  } catch (cause) {
    throw new CollaborationTransportError('server_certificate_invalid', 'Collaboration server certificate is invalid', { cause })
  }
}

export function requestPinnedJson(input: CollaborationRequest): Promise<unknown> {
  const url = new URL(input.path, `${normalizeServerUrl(input.serverUrl)}/`)
  if (!input.expectedSpkiSha256) {
    return Promise.reject(new CollaborationTransportError('server_certificate_invalid', 'An SPKI pin is required for Collaboration requests'))
  }
  const content = input.body === undefined ? null : Buffer.from(JSON.stringify(input.body), 'utf8')
  return new Promise((resolve, reject) => {
    let completed = false
    const fail = (error: unknown): void => {
      if (completed) return
      completed = true
      reject(error)
    }
    const request = httpsRequest({
      protocol: 'https:',
      hostname: url.hostname,
      port: Number(url.port || 443),
      path: `${url.pathname}${url.search}`,
      method: input.method,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      headers: {
        accept: 'application/json',
        ...(input.bearer ? { authorization: `Bearer ${input.bearer}` } : {}),
        ...(content ? { 'content-type': 'application/json', 'content-length': String(content.byteLength) } : {})
      }
    }, (response) => {
      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > 16 * 1024 * 1024) {
          response.destroy(new CollaborationTransportError('server_protocol_invalid', 'Collaboration response exceeds 16 MB'))
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      response.once('error', fail)
      response.once('end', () => {
        if (completed) return
        const body = Buffer.concat(chunks).toString('utf8')
        let value: unknown = null
        try {
          value = body ? JSON.parse(body) : null
        } catch (cause) {
          fail(new CollaborationTransportError('server_protocol_invalid', 'Collaboration server returned invalid JSON', { cause }))
          return
        }
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          const detail = value && typeof value === 'object' ? value as { code?: unknown; message?: unknown } : {}
          fail(new CollaborationTransportError(
            'server_request_failed',
            typeof detail.message === 'string' ? detail.message : `Collaboration request failed with HTTP ${response.statusCode}`
          ))
          return
        }
        completed = true
        resolve(value)
      })
    })
    request.once('error', fail)
    request.once('socket', (socket) => {
      const tlsSocket = socket as TLSSocket
      tlsSocket.once('secureConnect', () => {
        try {
          if (tlsSocket.getProtocol() !== 'TLSv1.3') {
            throw new CollaborationTransportError('server_tls_version_invalid', 'Collaboration server did not negotiate TLS 1.3')
          }
          const raw = tlsSocket.getPeerCertificate(true).raw
          if (!raw || spkiDigest(Buffer.from(raw)).toLowerCase() !== input.expectedSpkiSha256?.toLowerCase()) {
            throw new CollaborationTransportError('server_identity_changed', 'Collaboration server SPKI pin changed')
          }
          request.end(content ?? undefined)
        } catch (cause) {
          request.destroy(cause instanceof Error ? cause : new Error(String(cause)))
        }
      })
    })
  })
}

function spkiDigest(certificate: Buffer): string {
  const publicKey = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(publicKey).digest('hex')
}

function normalizeServerUrl(serverUrl: string): string {
  return normalizeIdentity({ serverUrl, serverInstanceId: 'normalize', spkiSha256: '0'.repeat(64) }).serverUrl
}

function normalizeIdentity(identity: ServerIdentity): ServerIdentity {
  const url = new URL(identity.serverUrl)
  if (url.protocol !== 'https:') {
    throw new CollaborationTransportError('server_tls_required', 'Collaboration server must use HTTPS')
  }
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return { ...identity, serverUrl: url.toString().replace(/\/$/, '') }
}
