import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Aes128Gcm, CipherSuite, HkdfSha256 } from '@hpke/core'
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519'
import { z } from 'zod'
import { writePrivateFileAtomic } from '../identity-vault-file'

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes128Gcm()
})

const StateSchema = z.object({
  version: z.literal(1),
  hpkePublicKey: z.string().min(1),
  hpkePrivateKey: z.string().min(1),
  tasks: z.record(z.string(), z.object({
    currentGeneration: z.number().int().positive(),
    keys: z.record(z.string(), z.string().min(1))
  }).strict())
}).strict()
type TaskKeyState = z.infer<typeof StateSchema>

const VaultEnvelopeSchema = z.object({
  version: z.literal(1),
  storage: z.literal('aes-256-gcm'),
  nonce: z.string(),
  tag: z.string(),
  ciphertext: z.string()
}).strict()

export type WrappedTaskKey = {
  version: 1
  algorithm: 'DHKEM_X25519_HKDF_SHA256/HKDF_SHA256/AES_128_GCM'
  taskId: string
  generation: number
  enc: string
  ciphertext: string
}

export type EncryptedTaskContent = {
  version: 1
  taskId: string
  generation: number
  nonce: string
  tag: string
  ciphertext: string
}

export class TaskKeyError extends Error {
  constructor(
    readonly code:
      | 'task_key_generation_unavailable'
      | 'task_key_state_invalid'
      | 'task_key_unwrap_failed',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'TaskKeyError'
  }
}

export class TaskKeyService {
  private constructor(
    private readonly path: string,
    private readonly vaultKey: Buffer,
    private state: TaskKeyState
  ) {}

  static async open(path: string, vaultKey: Buffer): Promise<TaskKeyService> {
    if (vaultKey.byteLength !== 32) throw new TaskKeyError('task_key_state_invalid', 'TaskKey vault key must be 32 bytes')
    const content = await readFile(path, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (content !== null) {
      return new TaskKeyService(path, Buffer.from(vaultKey), decryptState(content, vaultKey))
    }
    const keys = await suite.kem.generateKeyPair()
    const state = StateSchema.parse({
      version: 1,
      hpkePublicKey: Buffer.from(await suite.kem.serializePublicKey(keys.publicKey)).toString('base64'),
      hpkePrivateKey: Buffer.from(await suite.kem.serializePrivateKey(keys.privateKey)).toString('base64'),
      tasks: {}
    })
    const service = new TaskKeyService(path, Buffer.from(vaultKey), state)
    await service.save()
    return service
  }

  async publicKey(): Promise<string> {
    return this.state.hpkePublicKey
  }

  async sealTo(publicKey: string, plaintext: Buffer, info: Buffer): Promise<{ enc: string; ciphertext: string }> {
    const recipientPublicKey = await suite.kem.deserializePublicKey(Buffer.from(publicKey, 'base64'))
    const sender = await suite.createSenderContext({ recipientPublicKey, info })
    return {
      enc: Buffer.from(sender.enc).toString('base64'),
      ciphertext: Buffer.from(await sender.seal(plaintext)).toString('base64')
    }
  }

  async open(input: { enc: string; ciphertext: string }, info: Buffer): Promise<Buffer> {
    try {
      const privateKey = await suite.kem.deserializePrivateKey(Buffer.from(this.state.hpkePrivateKey, 'base64'))
      const recipient = await suite.createRecipientContext({
        recipientKey: privateKey,
        enc: Buffer.from(input.enc, 'base64'),
        info
      })
      return Buffer.from(await recipient.open(Buffer.from(input.ciphertext, 'base64')))
    } catch (cause) {
      throw new TaskKeyError('task_key_unwrap_failed', 'Pairwise HPKE payload could not be opened', { cause })
    }
  }

  async create(taskId: string): Promise<number> {
    requireTaskId(taskId)
    if (this.state.tasks[taskId]) return this.state.tasks[taskId].currentGeneration
    this.state.tasks[taskId] = { currentGeneration: 1, keys: { '1': randomBytes(32).toString('base64') } }
    await this.save()
    return 1
  }

  async rotate(taskId: string): Promise<number> {
    const task = this.requireTask(taskId)
    const generation = task.currentGeneration + 1
    task.currentGeneration = generation
    task.keys[String(generation)] = randomBytes(32).toString('base64')
    await this.save()
    return generation
  }

  async wrapFor(taskId: string, recipientPublicKey: string): Promise<WrappedTaskKey> {
    const task = this.requireTask(taskId)
    const recipientKey = await suite.kem.deserializePublicKey(Buffer.from(recipientPublicKey, 'base64'))
    const info = taskInfo(taskId, task.currentGeneration)
    const sender = await suite.createSenderContext({ recipientPublicKey: recipientKey, info })
    const ciphertext = await sender.seal(Buffer.from(task.keys[String(task.currentGeneration)], 'base64'))
    return {
      version: 1,
      algorithm: 'DHKEM_X25519_HKDF_SHA256/HKDF_SHA256/AES_128_GCM',
      taskId,
      generation: task.currentGeneration,
      enc: Buffer.from(sender.enc).toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64')
    }
  }

  async accept(envelope: WrappedTaskKey): Promise<void> {
    try {
      const privateKey = await suite.kem.deserializePrivateKey(Buffer.from(this.state.hpkePrivateKey, 'base64'))
      const recipient = await suite.createRecipientContext({
        recipientKey: privateKey,
        enc: Buffer.from(envelope.enc, 'base64'),
        info: taskInfo(envelope.taskId, envelope.generation)
      })
      const key = Buffer.from(await recipient.open(Buffer.from(envelope.ciphertext, 'base64')))
      if (key.byteLength !== 32) throw new Error('unwrapped TaskKey has invalid length')
      const existing = this.state.tasks[envelope.taskId] ?? { currentGeneration: envelope.generation, keys: {} }
      existing.currentGeneration = Math.max(existing.currentGeneration, envelope.generation)
      existing.keys[String(envelope.generation)] = key.toString('base64')
      this.state.tasks[envelope.taskId] = existing
      await this.save()
    } catch (cause) {
      if (cause instanceof TaskKeyError) throw cause
      throw new TaskKeyError('task_key_unwrap_failed', 'HPKE TaskKey envelope could not be opened', { cause })
    }
  }

  async encrypt(taskId: string, plaintext: Buffer): Promise<EncryptedTaskContent> {
    const task = this.requireTask(taskId)
    const generation = task.currentGeneration
    const key = Buffer.from(task.keys[String(generation)], 'base64')
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(taskInfo(taskId, generation))
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    return {
      version: 1,
      taskId,
      generation,
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  }

  async decrypt(taskId: string, content: EncryptedTaskContent): Promise<Buffer> {
    const task = this.requireTask(taskId)
    const encodedKey = task.keys[String(content.generation)]
    if (!encodedKey) {
      throw new TaskKeyError(
        'task_key_generation_unavailable',
        `TaskKey generation ${content.generation} is unavailable for ${taskId}`
      )
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', Buffer.from(encodedKey, 'base64'), Buffer.from(content.nonce, 'base64'))
      decipher.setAAD(taskInfo(taskId, content.generation))
      decipher.setAuthTag(Buffer.from(content.tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(content.ciphertext, 'base64')), decipher.final()])
    } catch (cause) {
      throw new TaskKeyError('task_key_generation_unavailable', 'Task content authentication failed', { cause })
    }
  }

  private requireTask(taskId: string) {
    const task = this.state.tasks[taskId]
    if (!task) throw new TaskKeyError('task_key_generation_unavailable', `No TaskKey is available for ${taskId}`)
    return task
  }

  private save(): Promise<void> {
    return writePrivateFileAtomic(this.path, `${JSON.stringify(encryptState(this.state, this.vaultKey), null, 2)}\n`)
  }
}

function taskInfo(taskId: string, generation: number): Buffer {
  return Buffer.from(`kun-task-key-v1\0${taskId}\0${generation}`, 'utf8')
}

function requireTaskId(taskId: string): void {
  if (!taskId.trim()) throw new TaskKeyError('task_key_state_invalid', 'Task id is required')
}

function encryptState(state: TaskKeyState, vaultKey: Buffer) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', vaultKey, nonce)
  cipher.setAAD(Buffer.from('kun-task-key-state-v1'))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()])
  return VaultEnvelopeSchema.parse({
    version: 1,
    storage: 'aes-256-gcm',
    nonce: nonce.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  })
}

function decryptState(content: string, vaultKey: Buffer): TaskKeyState {
  try {
    const envelope = VaultEnvelopeSchema.parse(JSON.parse(content))
    const decipher = createDecipheriv('aes-256-gcm', vaultKey, Buffer.from(envelope.nonce, 'base64'))
    decipher.setAAD(Buffer.from('kun-task-key-state-v1'))
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final()
    ])
    return StateSchema.parse(JSON.parse(plaintext.toString('utf8')))
  } catch (cause) {
    throw new TaskKeyError('task_key_state_invalid', 'TaskKey state could not be authenticated', { cause })
  }
}
