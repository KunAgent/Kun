import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AttachmentContent } from './attachment-store.js'
import { projectSharedAttachment, sharedAttachmentDirectory, sharedAttachmentName, sharedAttachmentReadPath } from './shared-attachment-content.js'
import { resolveWorkspacePath } from '../adapters/tool/builtin-tool-utils.js'
import { canWritePath } from '../adapters/tool/sandbox-policy.js'
import type { ToolHostContext } from '../ports/tool-host.js'
const id = 'att_' + 'a'.repeat(24)
function content(overrides: Partial<AttachmentContent> = {}): AttachmentContent {
  return { id, kind: 'image', mimeType: 'image/png', name: 'PRIVATE_ORIGINAL.png', byteSize: 5, hash: 'hash', data: Buffer.from('image'),
    localFilePath: '/private/PRIVATE_ORIGINAL.png', threadIds: ['thread'], workspaces: ['/private'], createdAt: '2001-01-01', updatedAt: '2001-01-01', ...overrides }
}
describe('shared-only attachment metadata and private copies', () => {
  it('keeps ordinary attachment identity, but shared [] always uses generic safe metadata and actual independent bytes', async () => {
    const value = content(), thread = 'shared-copy-' + Date.now()
    try {
      expect(await projectSharedAttachment(value, thread, undefined)).toBe(value)
      expect(sharedAttachmentName(value, undefined)).toBe('PRIVATE_ORIGINAL.png')
      const shared = await projectSharedAttachment(value, thread, [])
      expect(shared.name).toBe('attachment.png'); expect(shared.localFilePath).not.toContain('PRIVATE')
      expect(await readFile(shared.localFilePath!)).toEqual(value.data)
      expect((await stat(shared.localFilePath!)).mode & 0o222).toBe(0)
      const named = await projectSharedAttachment(value, thread, [{ attachmentId: id, displayName: 'visitor.png' }])
      expect(named.name).toBe('visitor.png'); expect(named.localFilePath).toBe(shared.localFilePath)
      expect(value.localFilePath).toBe('/private/PRIVATE_ORIGINAL.png'); expect(value.name).toBe('PRIVATE_ORIGINAL.png')
    } finally { await rm(sharedAttachmentDirectory(thread), { recursive: true, force: true }) }
  })
  it('authorizes only this task copy directory for tools, even in full access; copies remain read-only', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-shared-alias-policy-')), thread = 'policy-' + Date.now()
    const otherThread = thread + '-other'
    try {
      const own = await projectSharedAttachment(content(), thread, []), foreign = await projectSharedAttachment(content(), otherThread, [])
      const context: ToolHostContext = { threadId: thread, turnId: 'turn', workspace, attachmentAliases: [], clientSurface: 'api',
        sandboxMode: 'workspace-write', approvalPolicy: 'auto', abortSignal: new AbortController().signal, awaitApproval: async () => 'deny' }
      expect((await resolveWorkspacePath(own.localFilePath!, context)).absolutePath).toBe(await sharedAttachmentReadPath(own.localFilePath!, context))
      expect((await resolveWorkspacePath(dirname(own.localFilePath!), context)).absolutePath).toBeTruthy()
      expect(canWritePath(own.localFilePath!, { ...context, sandboxMode: 'danger-full-access' }).ok).toBe(false)
      await expect(resolveWorkspacePath(foreign.localFilePath!, { ...context, sandboxMode: 'danger-full-access' })).rejects.toThrow('SHARED_ATTACHMENT_PATH_REJECTED')
      await symlink(foreign.localFilePath!, join(workspace, 'foreign-copy.png'))
      await expect(resolveWorkspacePath('foreign-copy.png', { ...context, sandboxMode: 'danger-full-access' })).rejects.toThrow('SHARED_ATTACHMENT_PATH_REJECTED')
      await expect(resolveWorkspacePath('/private/PRIVATE_ORIGINAL.png', context)).rejects.toThrow()
      const ordinary = { ...context, attachmentAliases: undefined }
      await expect(resolveWorkspacePath(own.localFilePath!, ordinary)).rejects.toThrow('SHARED_ATTACHMENT_PATH_REJECTED')
    } finally { await rm(workspace, { recursive: true, force: true }); await rm(sharedAttachmentDirectory(thread), { recursive: true, force: true }); await rm(sharedAttachmentDirectory(otherThread), { recursive: true, force: true }) }
  })
  it('does not follow a private-copy symlink and repairs corrupted same-size cached bytes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'kun-shared-alias-links-')), thread = 'links-' + Date.now()
    try {
      const value = content(), shared = await projectSharedAttachment(value, thread, []), privateFile = join(workspace, 'private.txt')
      await writeFile(privateFile, 'OTHER')
      await rm(shared.localFilePath!); await symlink(privateFile, shared.localFilePath!)
      await expect(sharedAttachmentReadPath(shared.localFilePath!, { threadId: thread, attachmentAliases: [] })).rejects.toThrow('SHARED_ATTACHMENT_PATH_REJECTED')
      const fixed = await projectSharedAttachment(value, thread, [])
      expect(await readFile(fixed.localFilePath!)).toEqual(value.data)
      expect(await readFile(privateFile, 'utf8')).toBe('OTHER')
    } finally { await rm(workspace, { recursive: true, force: true }); await rm(sharedAttachmentDirectory(thread), { recursive: true, force: true }) }
  })
  it('bounds private copies instead of accumulating every shared attachment forever', async () => {
    const thread = 'bounded-' + Date.now()
    try {
      const first = await projectSharedAttachment(content({ id: 'att_' + '0'.repeat(24) }), thread, [])
      for (let i = 1; i <= 128; i++) await projectSharedAttachment(content({ id: 'att_' + i.toString(16).padStart(24, '0') }), thread, [])
      await expect(stat(first.localFilePath!)).rejects.toThrow()
    } finally { await rm(sharedAttachmentDirectory(thread), { recursive: true, force: true }) }
  })
})
