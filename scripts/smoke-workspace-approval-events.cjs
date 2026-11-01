'use strict'
const { randomUUID } = require('node:crypto')

// Observe the existing renderer SSE bridge, not a new HTTP route or a forged
// approval response. Keep only this fixture approval's two lifecycle events.
async function observeWorkspaceApproval(page, approval) {
  const streamId = 'workspace-consent-' + randomUUID()
  await page.evaluate(async ({ streamId, approval }) => {
    const api = window.kunGui
    const state = { requested: null, resolved: null, error: null }
    const offEvent = api.onSseEvent((payload) => {
      if (payload.streamId !== streamId) return
      for (const event of payload.events) {
        if (event.approvalId !== approval.id || event.threadId !== approval.threadId || event.turnId !== approval.turnId) continue
        if (event.kind === 'approval_requested') state.requested = event
        if (event.kind === 'approval_resolved') state.resolved = event
      }
    })
    const offError = api.onSseError((payload) => {
      if (payload.streamId === streamId) state.error = String(payload.message || payload.error || 'Approval observation failed')
    })
    const offEnd = api.onSseEnd((payload) => {
      if (payload.streamId === streamId) state.error = 'Approval observation stream ended'
    })
    window.__workspaceApprovalObservers ??= {}
    window.__workspaceApprovalObservers[streamId] = { state, offEvent, offError, offEnd }
    try { await api.startSse(approval.threadId, 0, streamId) }
    catch (error) {
      offEvent(); offError(); offEnd(); delete window.__workspaceApprovalObservers[streamId]
      await api.stopSse(streamId).catch(() => undefined)
      throw error
    }
  }, { streamId, approval: { id: approval.id, threadId: approval.threadId, turnId: approval.turnId } })
  return {
    read: () => page.evaluate((id) => window.__workspaceApprovalObservers[id].state, streamId),
    close: () => page.evaluate(async (id) => {
      const observer = window.__workspaceApprovalObservers[id]
      observer?.offEvent(); observer?.offError(); observer?.offEnd()
      delete window.__workspaceApprovalObservers[id]
      await window.kunGui.stopSse(id)
    }, streamId)
  }
}
module.exports = { observeWorkspaceApproval }
