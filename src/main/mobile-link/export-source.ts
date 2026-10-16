import { z } from 'zod'

const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)
const Export = z.union([
  z.object({ attachmentId: z.string().regex(/^att_[a-f0-9]{24}$/), threadId: Id }).strict(),
  z.object({ artifactId: Id, threadId: Id }).strict(),
  z.object({ artifactId: Id, agentId: Id, version: z.number().int().positive().optional() }).strict(),
  z.object({ agentId: Id, avatarRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  z.object({ projectId: Id, fileRef: Id, revision: z.string().regex(/^file-v1:[a-f0-9]{64}$/) }).strict()
])

/** Construct only known protected runtime routes, with authority supplied by the live connection. */
export function runtimeExportSource(
  input: unknown,
  scope: { owner: string; peer: string; authorizationId: string },
  runtimeToken: string
) {
  const params = Export.parse(input)
  const headers: Record<string, string> = { Authorization: 'Bearer ' + runtimeToken }
  let path: string
  if ('projectId' in params) {
    Id.parse(scope.owner); Id.parse(scope.peer); Id.parse(scope.authorizationId)
    path = '/v1/remote/project-files/' + params.projectId + '/' + params.fileRef +
      '?revision=' + encodeURIComponent(params.revision)
    headers['X-Kun-Remote-Account'] = scope.owner
    headers['X-Kun-Remote-Device'] = scope.peer
    headers['X-Kun-Remote-Authorization'] = scope.authorizationId
  } else if ('avatarRevision' in params) {
    path = '/v1/remote/agents/' + params.agentId + '/avatar?revision=' + params.avatarRevision
  } else if ('attachmentId' in params) {
    path = '/v1/remote/attachments/' + params.attachmentId + '?threadId=' + params.threadId
  } else if ('agentId' in params) {
    path = '/v1/remote/artifacts/agent/' + params.agentId + '/' + params.artifactId +
      (params.version ? '?version=' + params.version : '')
  } else {
    path = '/v1/remote/artifacts/code/' + params.threadId + '/' + params.artifactId
  }
  return { path, headers }
}
