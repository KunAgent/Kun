'use strict'

// This is an offline smoke diagnostic, not a generic profile dump. Read only
// the failed fixture Room and its corresponding run/tool/browser identities.
async function collectWorkspaceFailureDiagnostics({ page, request, roomId, execution, fixture, website }) {
  const read = async (operation) => {
    let timeout
    try {
      return { ok: true, value: await Promise.race([operation(), new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Diagnostic read exceeded 5 seconds')), 5000)
      })]) }
    } catch (error) { return { ok: false, error: String(error?.message ?? error) } }
    finally { clearTimeout(timeout) }
  }
  const result = { boundary: 'Offline personal workspace fixture only; read-only, bounded and credential-redacted',
    roomId, expectedExecution: execution, fixture: fixture?.snapshot(), website: website?.snapshot() }
  result.ui = await read(() => page.locator('[data-room-agent-browser]').evaluateAll((elements) => elements.map((element) => ({
    state: element.dataset.state, roomId: element.dataset.roomId, runId: element.dataset.runId,
    threadId: element.dataset.threadId, turnId: element.dataset.turnId, text: element.innerText,
    bounds: element.getBoundingClientRect().toJSON()
  }))))
  if (!roomId) return redactWorkspaceDiagnostics(result)
  result.direct = await read(() => request(page, `/v1/rooms/${encodeURIComponent(roomId)}/direct`))
  const direct = result.direct.value
  const candidates = [execution, direct?.execution, direct?.active, ...(direct?.requests ?? []).slice(0, 3)]
    .filter((value) => value?.runId && (!value.roomId || value.roomId === roomId))
  const runs = [...new Map(candidates.map((value) => [value.runId, value])).values()].slice(0, 4)
  result.runs = await Promise.all(runs.map(async (scope) => {
    const base = `/v1/rooms/${encodeURIComponent(roomId)}/runs/${encodeURIComponent(scope.runId)}`
    const [detail, items] = await Promise.all([
      read(() => request(page, base)),
      read(() => request(page, base + '/items?limit=100&max_bytes=262144'))
    ])
    // Retain actual tool calls/results, including isError, arguments and output;
    // do not include model reasoning, system context, screenshots or credentials.
    if (items.ok) items.value = { ...items.value, items: (items.value.items ?? []).filter((item) =>
      item.kind === 'tool_call' || item.kind === 'tool_result') }
    const identity = detail.value?.run ?? scope
    const browser = identity.threadId ? await read(() => page.evaluate(async ({ threadId, turnId }) => {
      const state = {}
      try { state.actual = await window.kunGui.getBrowserUseState(threadId) }
      catch (error) { state.actualError = String(error?.message ?? error) }
      if (turnId) {
        try { state.expectedTurn = await window.kunGui.getBrowserUseState(threadId, turnId) }
        catch (error) { state.expectedTurnError = String(error?.message ?? error) }
      }
      return state
    }, { threadId: identity.threadId, turnId: identity.turnId })) : undefined
    return { scope, detail, toolItems: items, browser }
  }))
  return redactWorkspaceDiagnostics(result)
}

function redactWorkspaceDiagnostics(value, depth = 0) {
  if (depth > 16) return '[depth bounded]'
  if (typeof value === 'string') {
    if (/^data:(?:image|audio|video)\//iu.test(value)) return '[binary preview omitted]'
    let text = value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [redacted]')
      .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret)["']?\s*[:=]\s*)["'][^"']*["']/giu, '$1"[redacted]"')
    if (text.length > 16384) text = text.slice(0, 16384) + '[truncated]'
    return text
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => redactWorkspaceDiagnostics(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, item]) => [key,
    /api.?key|authorization|password|credential|token|secret|signing.?key/iu.test(key)
      ? '[redacted]' : redactWorkspaceDiagnostics(item, depth + 1)]))
}
module.exports = { collectWorkspaceFailureDiagnostics, redactWorkspaceDiagnostics }
