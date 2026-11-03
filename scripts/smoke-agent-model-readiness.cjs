'use strict'
const assert = require('node:assert/strict')

function setupCancellationSettled(activity, requestId) {
  const request = activity.requests.find((item) => item.id === requestId)
  assert(request, 'The exact setup request must remain in the conversation')
  assert(!['failed', 'recovery_required', 'completed'].includes(request.status),
    'Setup must be cancelled before testing model controls: ' + request.status)
  return request.status === 'cancelled' && !activity.active && !activity.execution && activity.pendingCount === 0
}

// Only reopen a panel observed closed by metadata refresh. Never retry a model
// click: callers perform that consequential action once after this handshake.
async function prepareModelSelection({ poll, ready, panelVisible, open, expand, targetVisible, capture, timeoutMs = 30000 }) {
  const deadline = Date.now() + timeoutMs
  const remaining = () => {
    const value = deadline - Date.now()
    assert(value > 0, 'Timed out preparing the exact composer model selection')
    return value
  }
  await poll(async () => {
    if (!await ready()) return false
    if (!await panelVisible()) await open(remaining())
    if (!await panelVisible()) return false
    try {
      await expand(remaining())
    } catch (error) {
      if (!await panelVisible()) return false
      throw error
    }
    if (!await targetVisible()) return false
    await capture()
    return await panelVisible() && await ready() && await targetVisible()
  }, remaining(), 'settled composer panel and exact model option')
  return remaining()
}
module.exports = { setupCancellationSettled, prepareModelSelection }
