import { jsonResponse, type JsonResponse } from '../response.js'
import type { ServerRuntime } from './server-runtime.js'
import { getThreadTimeline } from './threads.js'
import { parseThreadTimelineQuery } from './thread-timeline-read-key.js'
import { HISTORY_TARGET_CURSOR_PREFIX } from '../../history/codex-history-target.js'

const SOURCE_CURSOR = 'history:'

/** External history is composed only at the read boundary, never hydrated into a writable store. */
export async function getComposedThreadTimeline(
  runtime: ServerRuntime, threadId: string, request: Request
): Promise<JsonResponse> {
  const native = (input = request) => getThreadTimeline(runtime.threadService, threadId, input,
    runtime.sessionStore, runtime.userInputGate, runtime.approvalGate, runtime.delegationRuntime)
  if (!runtime.historyReferences) return native()
  const thread = await runtime.threadService.getMetadata(threadId)
  if (!thread?.historyRefId) return native()
  const query = parseThreadTimelineQuery(new URL(request.url))
  if (!query.success) return jsonResponse({ code: 'invalid_request', message: 'Invalid timeline query' }, 400)
  const { before, turnId, itemId, limit } = query.data
  const prefix = `${SOURCE_CURSOR}${thread.historyRefId}:`
  const sourcePageRequested = before?.startsWith(SOURCE_CURSOR) === true
  if (sourcePageRequested && !before!.startsWith(prefix)) {
    return jsonResponse({ code: 'invalid_cursor', message: 'History cursor belongs to another reference' }, 400)
  }
  const sourceTurnRequested = /^(codex|claude-code):/u.test(turnId ?? '')
  const nativeUrl = new URL(request.url)
  if (sourcePageRequested) nativeUrl.searchParams.delete('before')
  if (sourceTurnRequested) {
    nativeUrl.searchParams.delete('turnId')
    nativeUrl.searchParams.delete('itemId')
  }
  const response = await native(new Request(nativeUrl, request))
  if (response.status !== 200) return response
  const body = JSON.parse(response.body)
  const source = runtime.historyReferences
  const reference = await source.get(thread.historyRefId)
  const descriptor = { provider: reference?.provider, referenceId: thread.historyRefId, readOnly: true }
  if (!source.isEnabled(reference?.provider)) {
    return jsonResponse({ ...body, sourceHistory: { ...descriptor, status: 'disabled', warnings: [] },
      ...(sourcePageRequested || sourceTurnRequested ? { turns: [], timeline: emptyPage() } : {}) })
  }
  if (!sourcePageRequested && !sourceTurnRequested && body.timeline.itemCount > 0) {
    return jsonResponse({ ...body, sourceHistory: descriptor, timeline: {
      ...body.timeline,
      ...(!body.timeline.hasMore && !turnId ? { hasMore: true, nextCursor: prefix } : {})
    } })
  }
  if (turnId && !sourceTurnRequested) return response
  try {
    const cursor = sourcePageRequested && before!.slice(prefix.length)
      ? decodeURIComponent(before!.slice(prefix.length)) : undefined
    const targetCursor = cursor?.startsWith(HISTORY_TARGET_CURSOR_PREFIX) ? cursor : undefined
    if (targetCursor && !sourceTurnRequested) {
      return jsonResponse({ code: 'invalid_cursor', message: 'A history target cursor requires its source turn' }, 400)
    }
    const page = await source.page(thread.historyRefId, {
      threadId, limit,
      ...(cursor && !targetCursor ? { cursor } : {}),
      ...(sourceTurnRequested ? { turnId, target: !cursor || Boolean(targetCursor), anchorItemId: itemId, targetCursor } : {})
    })
    if (sourceTurnRequested && !page.turns.length && page.status === 'available') {
      return jsonResponse({ code: 'not_found', message: 'Source turn is outside this branch' }, 404)
    }
    return jsonResponse({
      ...body,
      turns: page.turns,
      sourceHistory: { ...descriptor, status: page.status, warnings: page.warnings },
      timeline: {
        hasMore: page.hasMore,
        ...(page.nextCursor ? { nextCursor: `${prefix}${encodeURIComponent(page.nextCursor)}` } : {}),
        itemCount: page.itemCount, itemBytes: page.itemBytes,
        ...(page.target ? { target: {
          ...page.target,
          ...(page.target.previousCursor ? { previousCursor: `${prefix}${encodeURIComponent(page.target.previousCursor)}` } : {}),
          ...(page.target.nextCursor ? { nextCursor: `${prefix}${encodeURIComponent(page.target.nextCursor)}` } : {})
        } } : {})
      }
    })
  } catch (error) {
    return jsonResponse({ ...body, turns: [], timeline: emptyPage(), sourceHistory: {
      ...descriptor, status: 'missing', warnings: [error instanceof Error ? error.message : 'History unavailable']
    } })
  }
}

function emptyPage() {
  return { hasMore: false, itemCount: 0, itemBytes: 0 }
}
