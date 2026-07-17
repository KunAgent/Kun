import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify
} from 'node:crypto'
import { z } from 'zod'

const MAX_DELIVERY_BYTES = 100 * 1024 * 1024

const ManifestFileSchema = z.object({
  path: z.string().min(1).max(240),
  offset: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().length(64)
}).strict()

const UnsignedManifestSchema = z.object({
  version: z.literal(1),
  deliveryId: z.string().min(1),
  meetingId: z.string().min(1),
  senderMemberId: z.string().min(1),
  createdAt: z.iso.datetime(),
  totalBytes: z.number().int().nonnegative().max(MAX_DELIVERY_BYTES),
  contentSha256: z.string().length(64),
  files: z.array(ManifestFileSchema).max(10_000),
  recipientKeyEnvelopes: z.array(z.object({
    recipientMemberId: z.string().min(1),
    envelope: z.string().min(1)
  }).strict()).min(1)
}).strict()

export const SignedArtifactManifestSchema = UnsignedManifestSchema.extend({
  signature: z.string().min(1)
}).strict()
export type SignedArtifactManifest = z.infer<typeof SignedArtifactManifestSchema>

export async function createArtifactPackage(input: {
  deliveryId: string
  meetingId: string
  senderMemberId: string
  files: Map<string, Buffer>
  wrapContentKey: (contentKey: Buffer) => Promise<Array<{ recipientMemberId: string; envelope: string }>>
  signingPrivateKey: Buffer
}): Promise<{ manifest: SignedArtifactManifest; content: Buffer; contentKey: Buffer }> {
  const ordered = [...input.files.entries()].sort(([left], [right]) => left.localeCompare(right))
  let offset = 0
  const chunks: Buffer[] = []
  const files = ordered.map(([path, value]) => {
    validatePackagePath(path)
    const content = Buffer.from(value)
    const file = { path, offset, bytes: content.byteLength, sha256: sha256(content) }
    offset += content.byteLength
    if (offset > MAX_DELIVERY_BYTES) throw new Error('Artifact content exceeds 100 MB')
    chunks.push(content)
    return file
  })
  const content = Buffer.concat(chunks)
  const contentKey = randomBytes(32)
  const recipientKeyEnvelopes = await input.wrapContentKey(Buffer.from(contentKey))
  const unsigned = UnsignedManifestSchema.parse({
    version: 1,
    deliveryId: input.deliveryId,
    meetingId: input.meetingId,
    senderMemberId: input.senderMemberId,
    createdAt: new Date().toISOString(),
    totalBytes: content.byteLength,
    contentSha256: sha256(content),
    files,
    recipientKeyEnvelopes
  })
  const privateKey = createPrivateKey({ key: input.signingPrivateKey, type: 'pkcs8', format: 'der' })
  return {
    manifest: SignedArtifactManifestSchema.parse({
      ...unsigned,
      signature: sign(null, canonicalManifest(unsigned), privateKey).toString('base64')
    }),
    content,
    contentKey
  }
}

export function verifyArtifactPackage(input: {
  manifest: SignedArtifactManifest
  content: Buffer
  signingPublicKey: Buffer
}): Map<string, Buffer> {
  const manifest = SignedArtifactManifestSchema.parse(input.manifest)
  const { signature, ...unsigned } = manifest
  const publicKey = createPublicKey({ key: input.signingPublicKey, type: 'spki', format: 'der' })
  if (!verify(null, canonicalManifest(unsigned), publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('Artifact manifest signature is invalid')
  }
  if (input.content.byteLength !== manifest.totalBytes || sha256(input.content) !== manifest.contentSha256) {
    throw new Error('Artifact package content hash is invalid')
  }
  const files = new Map<string, Buffer>()
  for (const file of manifest.files) {
    validatePackagePath(file.path)
    const end = file.offset + file.bytes
    if (end > input.content.byteLength) throw new Error(`Artifact file content is out of bounds: ${file.path}`)
    const value = Buffer.from(input.content.subarray(file.offset, end))
    if (sha256(value) !== file.sha256) throw new Error(`Artifact file content hash is invalid: ${file.path}`)
    files.set(file.path, value)
  }
  return files
}

function canonicalManifest(value: z.infer<typeof UnsignedManifestSchema>): Buffer {
  return Buffer.from(JSON.stringify(UnsignedManifestSchema.parse(value)), 'utf8')
}

function validatePackagePath(path: string): void {
  const parts = path.split('/')
  if (!path || path.includes('\\') || path.startsWith('/') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Artifact package path is invalid: ${path}`)
  }
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
