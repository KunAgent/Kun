import { describe, expect, it } from 'vitest'
import { runtimeExportSource } from './export-source'

const scope = { owner: 'account', peer: 'phone', authorizationId: 'lease' }
const revision = 'file-v1:' + 'a'.repeat(64)

describe('protected remote file export sources', () => {
  it('binds a project file to the current account/device/authorization and keeps credentials out of the URL', () => {
    const result = runtimeExportSource({ projectId: 'project', fileRef: 'opaque-file', revision }, scope, 'runtime-secret')
    expect(result.path).toBe('/v1/remote/project-files/project/opaque-file?revision=' + encodeURIComponent(revision))
    expect(result.headers).toEqual({ Authorization: 'Bearer runtime-secret',
      'X-Kun-Remote-Account': 'account', 'X-Kun-Remote-Device': 'phone', 'X-Kun-Remote-Authorization': 'lease' })
    expect(result.path).not.toContain('secret')
  })
  it('does not accept paths, authority overrides, or mixed export variants', () => {
    for (const input of [
      { projectId: 'project', fileRef: '../secret', revision },
      { projectId: 'project', fileRef: 'file', revision, accountId: 'other' },
      { projectId: 'project', fileRef: 'file', revision, path: '/private/secret' },
      { projectId: 'project', fileRef: 'file', revision, artifactId: 'artifact', threadId: 'task' },
      { projectId: 'project', fileRef: 'file', revision: 'latest' }
    ]) expect(() => runtimeExportSource(input, scope, 'token')).toThrow()
  })
  it('exports only the exact current Agent avatar revision without accepting caller URLs or mixed variants', () => {
    expect(runtimeExportSource({ agentId: 'agent', avatarRevision: 7 }, scope, 'runtime-secret')).toEqual({
      path: '/v1/remote/agents/agent/avatar?revision=7', headers: { Authorization: 'Bearer runtime-secret' }
    })
    for (const input of [
      { agentId: '../private', avatarRevision: 7 }, { agentId: 'agent', avatarRevision: -1 },
      { agentId: 'agent', avatarRevision: 1.5 }, { agentId: 'agent', avatarRevision: Number.MAX_SAFE_INTEGER + 1 },
      { agentId: 'agent', avatarRevision: 7, artifactId: 'artifact' },
      { agentId: 'agent', avatarRevision: 7, path: '/private/file' },
      { agentId: 'agent', avatarRevision: 7, url: 'https://external.test/image' }
    ]) expect(() => runtimeExportSource(input, scope, 'token')).toThrow()
  })
  it('preserves the exact legacy attachment and artifact routes', () => {
    const attachment = 'att_' + 'b'.repeat(24)
    expect(runtimeExportSource({ attachmentId: attachment, threadId: 'task' }, scope, 'token').path)
      .toBe('/v1/remote/attachments/' + attachment + '?threadId=task')
    expect(runtimeExportSource({ artifactId: 'artifact', threadId: 'task' }, scope, 'token').path)
      .toBe('/v1/remote/artifacts/code/task/artifact')
    expect(runtimeExportSource({ artifactId: 'artifact', agentId: 'agent', version: 2 }, scope, 'token').path)
      .toBe('/v1/remote/artifacts/agent/agent/artifact?version=2')
  })
})
