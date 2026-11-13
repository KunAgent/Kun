import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { requireCode } from '../code/access.js'
import { GitChanges } from './git.js'
import { permittedProjectChange } from '../files/project-file-permissions.js'

export class RemoteCodeChanges {
  constructor(private readonly runtime: ServerRuntime) {}
  async dispatch(method: string, params: { threadId: string; path?: string; revision?: string }) {
    const thread = await requireCode(this.runtime, params.threadId)
    if (!thread.workspace) throw new Error('WORKSPACE_UNAVAILABLE')
    const changes = new GitChanges(thread.workspace, (root, path) => permittedProjectChange(this.runtime, root, path))
    return method === 'code.changes.list' ? changes.list() : changes.get(params.path!, params.revision!)
  }
}
