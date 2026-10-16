import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { AgentProfileImportService } from '../../agents/agent-profile-import.js'
import { PolicyMutationRejected } from '../../domain/remote-policy-revision.js'
import type { Envelope, RemoteScope } from '../contracts.js'
import { receiptKey, type Receipt } from '../requests/receipts.js'
import { RemoteNoEffect } from '../requests/rejections.js'

/** Imports only the validated profile; setup execution remains a native, separate action. */
export class RemoteAgentImport {
  private importer: AgentProfileImportService

  constructor(runtime: ServerRuntime) {
    this.importer = new AgentProfileImportService(runtime.rooms!)
  }

  async dispatch(method: string, p: any, envelope: Envelope): Promise<unknown> {
    const clientRequestId = receiptKey(envelope, envelope.call.requestId)
    const scope = {
      accountId: envelope.accountId,
      deviceId: envelope.deviceId,
      authorizationId: envelope.authorizationId
    }
    try {
      if (method === 'agent.import.preview') {
        return await this.importer.preview(scope, clientRequestId, {
          ...p.document.profile,
          ...(p.name !== undefined ? { name: p.name } : {})
        })
      }
      // Never persist the transport envelope as profile or native identity data.
      return await this.importer.commit(scope, clientRequestId, p)
    } catch (error) {
      if (error instanceof PolicyMutationRejected) throw new RemoteNoEffect(error.code)
      throw error
    }
  }

  recover(scope: RemoteScope, receipt: Receipt) {
    return this.importer.recover(scope, receiptKey(scope, receipt.requestId), receipt.method === 'agent.import.preview')
  }
}
